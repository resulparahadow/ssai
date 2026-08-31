# Deploying SmartStars CRM to Ubuntu 24.04

A single-host deploy of the Docker stack (see [`docker/README.md`](../docker/README.md)
for the service breakdown), fronted by **Caddy** for automatic HTTPS. Everything
runs in containers; the only things you install on the host are Docker and a
firewall rule set.

**Compose invocation used throughout** (prod stack + TLS overlay + prod env):

```bash
docker compose -f compose.prod.yaml -f compose.caddy.yaml --env-file .env.docker <cmd>
```

Set these once per shell to type just `docker compose <cmd>`:

```bash
export COMPOSE_FILE=compose.prod.yaml:compose.caddy.yaml
export COMPOSE_ENV_FILES=.env.docker
```

---

## A. Provision the server

- Ubuntu **24.04 LTS (noble)**, **≥ 2 vCPU / 4 GB RAM / 25 GB disk**. The image is
  built on the box (`composer install` + `npm run build`), which needs the RAM; a
  1 GB droplet will OOM the Vite build.
- SSH in as root, create a sudo non-root user, and log back in as them:

  ```bash
  adduser deploy
  usermod -aG sudo deploy
  # (copy your SSH key to the new user, then reconnect as deploy)
  ```

- Firewall — allow SSH + the two public web ports only:

  ```bash
  sudo ufw allow OpenSSH
  sudo ufw allow 80/tcp
  sudo ufw allow 443/tcp
  sudo ufw allow 443/udp   # HTTP/3 (QUIC) — Caddy also publishes 443/udp
  sudo ufw enable
  ```

  > MySQL/Redis/engine are **never** host-published (internal Docker network only),
  > so nothing else needs opening. Note: Docker manages its own iptables rules; the
  > only ports it publishes here are Caddy's 80/443, which you want public anyway.

## B. Point DNS at the server

Create an `A` record (and `AAAA` if you have IPv6) for your domain →  the server's
public IP **before** the first launch. Caddy proves domain ownership over
ports 80/443, so the name must resolve and those ports be reachable, or cert
issuance fails. Verify:

```bash
dig +short your-domain.com    # should print the server IP
```

## C. Install Docker Engine + Compose plugin

Official apt repository (Docker's own instructions for Ubuntu):

```bash
# Docker's GPG key
sudo apt-get update
sudo apt-get install -y ca-certificates curl
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc

# Add the repo (deb822 format)
sudo tee /etc/apt/sources.list.d/docker.sources > /dev/null <<EOF
Types: deb
URIs: https://download.docker.com/linux/ubuntu
Suites: $(. /etc/os-release && echo "${UBUNTU_CODENAME:-$VERSION_CODENAME}")
Components: stable
Architectures: $(dpkg --print-architecture)
Signed-By: /etc/apt/keyrings/docker.asc
EOF

sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io \
  docker-buildx-plugin docker-compose-plugin

# Run docker without sudo (log out/in afterwards for the group to take effect)
sudo usermod -aG docker $USER
```

Verify (reconnect first so the `docker` group applies):

```bash
docker run --rm hello-world
docker compose version   # expect v2.24+ (needed for the !reset overlay)
```

## D. Get the code

```bash
sudo mkdir -p /opt/ssai && sudo chown $USER:$USER /opt/ssai
git clone <your-repo-url> /opt/ssai
cd /opt/ssai
```

Private repo? Use a deploy key or a `https://<token>@github.com/...` URL.

## E. Configure the environment

```bash
cp .env.docker.example .env.docker
```

Generate secrets and edit `.env.docker`:

```bash
# APP_KEY (Laravel needs base64:... ; no image required):
echo "base64:$(openssl rand -base64 32)"

# DB + Reverb secrets:
openssl rand -hex 24    # -> DB_PASSWORD
openssl rand -hex 24    # -> DB_ROOT_PASSWORD
openssl rand -hex 16    # -> REVERB_APP_KEY
openssl rand -hex 16    # -> REVERB_APP_SECRET
# REVERB_APP_ID: any integer, e.g. 481920
```

Set these keys in `.env.docker`:

| Key | Value |
|-----|-------|
| `APP_KEY` | the `base64:...` above |
| `APP_URL` | `https://your-domain.com` |
| `SITE_ADDRESS` | `your-domain.com` (Caddy issues the cert for this) |
| `DB_PASSWORD`, `DB_ROOT_PASSWORD` | the generated hex values |
| `REVERB_APP_ID/KEY/SECRET` | the generated values |
| `ANTHROPIC_API_KEY`, `OPENROUTER_API_KEY`, `ONLYFANS_API_KEY` | **fresh, rotated** provider keys (see warning) |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD` | first admin login (used by the seeder in §G) |

`VITE_REVERB_HOST/PORT/SCHEME` already resolve to your domain over 443/https via
`SITE_ADDRESS` — leave them. `REVERB_HOST=reverb` (internal) stays as-is.

> ⚠ **Rotate leaked keys.** Earlier commits of `.env.docker.example` contained live
> Anthropic / OpenRouter / OnlyFans keys. Treat them as compromised: rotate each at
> the provider and put the **new** keys in `.env.docker` (which is git-ignored).

## F. Build and launch

```bash
docker compose -f compose.prod.yaml -f compose.caddy.yaml --env-file .env.docker build
docker compose -f compose.prod.yaml -f compose.caddy.yaml --env-file .env.docker up -d
docker compose -f compose.prod.yaml -f compose.caddy.yaml --env-file .env.docker ps
```

The `app` entrypoint waits for MySQL, runs migrations (`RUN_MIGRATIONS=true` on
`app` only), links storage, and caches config/routes/views before PHP-FPM starts.

Watch Caddy obtain the certificate:

```bash
docker compose ... logs -f caddy    # look for "certificate obtained successfully"
```

> First run failing to get a cert? Re-check §B (DNS resolves, ports 80/443 open).
> To dry-run without hitting rate limits, use the staging-CA toggle documented in
> `docker/caddy/Caddyfile`, then switch back for the real cert.

## G. Seed the first admin

```bash
docker compose ... exec app php artisan db:seed --class=ProductionSeeder --force
```

Creates the admin (from `ADMIN_EMAIL`/`ADMIN_PASSWORD`) + a single `Test` creator
model. Idempotent (`updateOrCreate`). To use a creator with OnlyFans, set its
`aich_models.of_account_id` (`acct_…`) — via the Creator Models UI or tinker.

## H. Verify

```bash
docker compose ... ps                       # every service healthy/running
curl -fsS https://your-domain.com/up        # Laravel health endpoint -> 200
```

Then in a browser:
- Log in as the admin.
- Open **Conversations** for an OF-mapped creator → chats/messages load live.
- Trigger a realtime event (inbound message / another tab) → toast fires =
  Reverb is reachable over `wss://your-domain.com/app`.
- **Generate** in a chat → the Node engine returns a draft.

## I. Operate

```bash
# Logs
docker compose ... logs -f app          # or: reverb / caddy / engine

# Update to new code
git pull
docker compose ... build app
docker compose ... up -d app queue reverb scheduler
#   rebuild `web` only when docker/nginx/default.conf changes;
#   rebuild `app` + `web` when VITE_REVERB_* / other build-time vars change.

# Restart everything (survives host reboot via restart: unless-stopped anyway)
docker compose ... up -d
```

**Back up** the named volumes — they hold all persistent state:

| Volume | Holds |
|--------|-------|
| `mysql-data` | the database |
| `redis-data` | cache/sessions/queue |
| `storage` | Laravel `storage/` (logs, uploads) |
| `caddy-data` | **TLS certs + ACME account** — losing it re-triggers issuance |

Example DB dump:

```bash
docker compose ... exec mysql \
  sh -c 'exec mysqldump -uroot -p"$MYSQL_ROOT_PASSWORD" ssai_crm' > backup-$(date +%F).sql
```

`docker compose ... down` (without `-v`) stops the stack but keeps the volumes.
`down -v` **deletes** them — don't, unless you mean it.

## Scaling later (out of scope here)

For multiple app replicas, move migrations into a one-shot `migrate` service (see
`docker/README.md`) and build images in CI, pushing to a registry the server pulls
from instead of building on-box. Not needed for a single host.
