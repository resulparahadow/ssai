# syntax=docker/dockerfile:1
#
# SmartStars CRM — multi-stage, multi-target build.
#   Targets:
#     app     -> PHP-FPM runtime (also runs queue / reverb / scheduler)
#     web     -> nginx serving public/ + proxying to app + reverb
#     engine  -> Node sidecar running the legacy generation pipeline
#
# The asset build needs PHP present: the Wayfinder Vite plugin shells out to
# `php artisan wayfinder:generate`, so composer + node run together in one
# `build` stage. Compose builds all three targets via compose.prod.yaml.

ARG PHP_VERSION=8.3
ARG NODE_VERSION=22

#######################  Stage 1: shared PHP base  ############################
# Extensions + ini used by BOTH the builder and the runtime app image.
FROM php:${PHP_VERSION}-fpm-alpine AS php-base
WORKDIR /var/www/html
COPY --from=mlocati/php-extension-installer:latest /usr/bin/install-php-extensions /usr/local/bin/
RUN install-php-extensions \
        pdo_mysql \
        mbstring \
        bcmath \
        intl \
        zip \
        opcache \
        pcntl \
        posix \
        redis \
    && apk add --no-cache fcgi
COPY docker/php/php.ini      "$PHP_INI_DIR/conf.d/zz-app.ini"
COPY docker/php/opcache.ini  "$PHP_INI_DIR/conf.d/zz-opcache.ini"
COPY docker/php-fpm/www.conf /usr/local/etc/php-fpm.d/zz-www.conf

########################  Stage 2: builder  ###################################
# PHP (from base) + Composer + Node. Installs deps and compiles front-end assets.
FROM php-base AS build
RUN apk add --no-cache nodejs npm git unzip
COPY --from=composer:2 /usr/bin/composer /usr/bin/composer

# Vite compiles VITE_* into the client bundle, so the public-facing Reverb
# host/scheme MUST be provided here (a rebuild is needed to change them).
ARG VITE_APP_NAME="SmartStars"
ARG VITE_REVERB_APP_KEY=""
ARG VITE_REVERB_HOST="localhost"
ARG VITE_REVERB_PORT="443"
ARG VITE_REVERB_SCHEME="https"
ENV VITE_APP_NAME=${VITE_APP_NAME} \
    VITE_REVERB_APP_KEY=${VITE_REVERB_APP_KEY} \
    VITE_REVERB_HOST=${VITE_REVERB_HOST} \
    VITE_REVERB_PORT=${VITE_REVERB_PORT} \
    VITE_REVERB_SCHEME=${VITE_REVERB_SCHEME}

# Node deps first for layer caching.
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci

# Full app source, then PHP deps (optimized autoloader needs app/ present).
COPY . .
RUN --mount=type=cache,target=/root/.composer/cache \
    composer install --no-dev --optimize-autoloader --no-scripts \
    --no-interaction --no-progress --prefer-dist

# Build assets. Wayfinder spawns `php artisan`, which boots the framework — give
# it a throwaway APP_KEY (never persisted; runtime key comes from .env). Then
# drop node_modules so it isn't carried into the runtime image.
RUN APP_KEY="base64:$(head -c 32 /dev/urandom | base64)" npm run build \
    && rm -rf node_modules

######################  Stage 3: app (PHP-FPM runtime)  #######################
FROM php-base AS app
COPY docker/entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

# App code + vendor + compiled assets from the builder (no node_modules/tests).
COPY --from=build --chown=www-data:www-data /var/www/html /var/www/html
RUN mkdir -p \
        storage/framework/cache/data storage/framework/sessions \
        storage/framework/views storage/logs storage/app/public bootstrap/cache \
    && chown -R www-data:www-data storage bootstrap/cache \
    # Stage the compiled assets outside the future public/build volume mount so
    # the entrypoint can publish them into the shared volume (nginx serves them).
    && cp -a public/build /usr/local/share/ssai-build

# FPM healthcheck via the pool's /ping endpoint.
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
    CMD REDIRECT_STATUS=true SCRIPT_NAME=/ping SCRIPT_FILENAME=/ping REQUEST_METHOD=GET \
        cgi-fcgi -bind -connect 127.0.0.1:9000 || exit 1

USER www-data
EXPOSE 9000
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
CMD ["php-fpm"]

############################  Stage 4: web (nginx)  ###########################
# Serve the built public/ from the same absolute path the app image uses, so
# FastCGI SCRIPT_FILENAME resolves inside the php-fpm container.
FROM nginx:alpine AS web
COPY docker/nginx/default.conf /etc/nginx/conf.d/default.conf
COPY --from=build /var/www/html/public /var/www/html/public
EXPOSE 80

##########################  Stage 5: engine (Node)  ###########################
# The engine loads legacy/js/*.js at runtime and has zero npm dependencies.
FROM node:${NODE_VERSION}-alpine AS engine
WORKDIR /var/www/html
ENV NODE_ENV=production \
    ENGINE_HOST=0.0.0.0 \
    ENGINE_PORT=8787
COPY --chown=node:node engine/ ./engine/
COPY --chown=node:node legacy/  ./legacy/
USER node
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD wget -qO- http://127.0.0.1:8787/health >/dev/null 2>&1 || exit 1
CMD ["node", "engine/server.js"]

##########################  Stage 6: dev (local development)  #################
# Local dev PHP-FPM: prod php-base extensions + composer + git. Source is
# bind-mounted at runtime (no COPY), so code changes reflect live. Opcache is
# disabled via zzz-dev.ini. NOT built by prod (compose.prod.yaml targets
# app/web/engine only) — this stage never affects the production images.
FROM php-base AS dev
# node/npm are here too so the `vite` dev service can run in this image: the
# Wayfinder Vite plugin shells out to `php artisan wayfinder:generate`, so the
# Vite process needs BOTH php and node (same reason the prod `build` stage does).
RUN apk add --no-cache git unzip nodejs npm
COPY --from=composer:2 /usr/bin/composer /usr/bin/composer
COPY docker/dev/php-dev.ini "$PHP_INI_DIR/conf.d/zzz-dev.ini"
COPY docker/dev/entrypoint.sh /usr/local/bin/dev-entrypoint.sh
RUN chmod +x /usr/local/bin/dev-entrypoint.sh
ENTRYPOINT ["/usr/local/bin/dev-entrypoint.sh"]
CMD ["php-fpm"]
