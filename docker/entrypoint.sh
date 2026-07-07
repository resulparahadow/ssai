#!/bin/sh
# SmartStars — entrypoint for the "app" image (php-fpm, queue, reverb, scheduler).
# Prepares writable dirs, waits for MySQL, optionally migrates, caches config,
# then hands off to the container's CMD.
set -e

APP_DIR=/var/www/html
cd "$APP_DIR"

# 1. Ensure the runtime-writable directories exist (the storage volume may start empty).
mkdir -p \
    storage/framework/cache/data \
    storage/framework/sessions \
    storage/framework/views \
    storage/framework/testing \
    storage/logs \
    storage/app/public \
    bootstrap/cache

# 1b. Publish this image's compiled assets into the (shared) public/build so nginx
#     serves exactly the manifest this app references — prevents app/web drift.
if [ -d /usr/local/share/ssai-build ]; then
    mkdir -p public/build
    cp -a /usr/local/share/ssai-build/. public/build/ 2>/dev/null || true
fi

# 2. Wait for MySQL to accept connections before doing anything DB-dependent.
echo "[entrypoint] waiting for database at ${DB_HOST:-mysql}:${DB_PORT:-3306} ..."
i=0
until php -r '
    $h = getenv("DB_HOST") ?: "mysql";
    $p = getenv("DB_PORT") ?: "3306";
    $u = getenv("DB_USERNAME") ?: "root";
    $w = getenv("DB_PASSWORD") ?: "";
    try { new PDO("mysql:host={$h};port={$p}", $u, $w, [PDO::ATTR_TIMEOUT => 2]); exit(0); }
    catch (Throwable $e) { exit(1); }
' 2>/dev/null; do
    i=$((i + 1))
    if [ "$i" -ge 60 ]; then
        echo "[entrypoint] database not reachable after 120s — aborting." >&2
        exit 1
    fi
    sleep 2
done
echo "[entrypoint] database is up."

# 3. Run migrations only where explicitly enabled (set RUN_MIGRATIONS=true on one service).
if [ "${RUN_MIGRATIONS:-false}" = "true" ]; then
    echo "[entrypoint] running migrations..."
    php artisan migrate --force --no-interaction
fi

# 3b. Optionally seed the minimal production data (admin + Test model). Opt-in and
#     idempotent — enable on the app service only (RUN_SEEDERS=true).
if [ "${RUN_SEEDERS:-false}" = "true" ]; then
    echo "[entrypoint] seeding production data..."
    php artisan db:seed --class=ProductionSeeder --force --no-interaction
fi

# 4. Ensure the public storage symlink exists (idempotent).
php artisan storage:link --no-interaction 2>/dev/null || true

# 5. Cache config/routes/views/events now that the environment is fully present.
php artisan optimize

echo "[entrypoint] starting: $*"
exec "$@"
