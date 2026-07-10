#!/bin/sh
# SmartStars — LOCAL DEV entrypoint (php dev image: app/queue/reverb/scheduler).
# Source is bind-mounted; vendor/ is a shared named volume. NO config cache so
# env + code changes reflect live. The `app` service (DEV_BOOTSTRAP=true) owns
# the one-time composer install + migrate; the others wait for vendor/ then run.
set -e
cd /var/www/html

# Runtime-writable dirs (bind/volume may start bare).
mkdir -p storage/framework/cache/data storage/framework/sessions \
    storage/framework/views storage/logs storage/app/public bootstrap/cache

if [ "${DEV_BOOTSTRAP:-false}" = "true" ]; then
    if [ ! -f vendor/autoload.php ]; then
        echo "[dev] composer install (first run may take a minute)..."
        composer install --no-interaction --prefer-dist
    fi
    # mysql is already 'service_healthy' via depends_on before we get here.
    php artisan migrate --no-interaction || true
    php artisan storage:link --no-interaction 2>/dev/null || true
else
    echo "[dev] waiting for vendor/ (installed by the app service)..."
    i=0
    until [ -f vendor/autoload.php ]; do
        i=$((i + 1))
        [ "$i" -ge 150 ] && { echo "[dev] vendor/ never appeared" >&2; exit 1; }
        sleep 2
    done
fi

echo "[dev] starting: $*"
exec "$@"
