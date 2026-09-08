# Deploy — Proxmox VM with auto-redeploy

How ProjectProject is hosted on a homelab Proxmox box. The pipeline:

```
push to main
   ↓
GitHub Actions builds two images
   ↓
ghcr.io/<owner>/projectproject-{app,web}:latest
   ↓
Watchtower (on the deploy VM) polls GHCR every 5 minutes
   ↓
docker compose recreates `app` + `web` with the new image
   ↓
nginx-proxy-manager continues to forward your public hostname → `web` :8080
```

No SSH from CI to the homelab. No public ports on the homelab beyond what NPM
already exposes. Image tags are immutable per commit (`sha-<short>`) so
rollbacks are one env var away.

---

## One-time setup

### 1. Create a Proxmox VM

A small Debian / Ubuntu VM is fine. Suggested baseline:

- 2 vCPU
- 2 GB RAM (1 GB works for low load)
- 16 GB disk (more if `data/` will hold many projects)
- Network bridge to your LAN so NPM can reach it

Install Docker + Compose v2. The official `get.docker.com` script is the
fastest path:

```sh
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER
# log out and back in for the group to apply
```

### 2. Lay out `/srv/projectproject` on the VM

```sh
sudo mkdir -p /srv/projectproject/data
sudo chown -R $USER:$USER /srv/projectproject
```

Then drop in the compose file and the `.env`:

```sh
cd /srv/projectproject
curl -O https://raw.githubusercontent.com/<owner>/projectproject/main/docker-compose.prod.yml
mv docker-compose.prod.yml compose.yaml
# fetch the env template:
curl -O https://raw.githubusercontent.com/<owner>/projectproject/main/.env.production.example
mv .env.production.example .env
```

Edit `.env` and fill in:

- `IMAGE_OWNER` — your GitHub username/org (lowercase).
- `POSTGRES_PASSWORD` — a strong random string.
- `BETTER_AUTH_SECRET` — `openssl rand -hex 32`.
- `BETTER_AUTH_URL` — the public HTTPS URL you'll point at this VM.
- `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` — from your GitHub OAuth app.
- `GITHUB_APP_WEBHOOK_SECRET` — the secret configured on the GitHub App webhook.
- `BOOTSTRAP_ORG_SLUG` / `BOOTSTRAP_ORG_NAME` — the first organization to create.
- `BOOTSTRAP_OWNER_EMAIL` / `BOOTSTRAP_OWNER_NAME` / `BOOTSTRAP_OWNER_USERNAME` — the initial owner identity. Use the same email and username as the GitHub account that will sign in.

The GitHub OAuth app's "Authorization callback URL" must be:

```
https://<your-public-host>/api/auth/callback/github
```

The GitHub App webhook URL must be:

```txt
https://<your-public-host>/api/integrations/github/webhook
```

Subscribe the GitHub App webhook to `installation`,
`installation_repositories`, and `pull_request` events.

### 3. First boot

```sh
cd /srv/projectproject
docker compose pull
docker compose up -d
docker compose logs -f app
```

You should see the backend listening on `:3000` (inside the compose network)
and `web` exposing `:8080` on the VM.

### 4. Rebuild the ticket index

The release that adds migration `0015` creates an empty `ticket_index` table.
Existing ticket lists, counts, search results, and tag usage counts stay empty
until the markdown tickets are indexed.

Run this once after migrations:

```sh
cd /srv/projectproject
docker compose run --rm app bun run ticket-index:rebuild
```

### 5. Bootstrap the first organization

ProjectProject does not expose a public "first user creates the org" flow.
After migrations have run, create the configured org and owner membership
from the VM:

```sh
cd /srv/projectproject
docker compose run --rm app bun run bootstrap:org
```

The command is repeat-safe. Re-running it reports the existing org, owner,
and membership instead of creating duplicates. After bootstrap, the owner signs
in with the configured email (magic link or Google), then invites teammates
from org settings. Invited users open their invite link (or `/welcome`), sign
in with the invited email, and land inside the org. Connecting a personal
GitHub account for branch automation happens later, from the profile page.

### 6. nginx-proxy-manager

Add a Proxy Host in NPM:

- **Domain:** `projectproject.example.com`
- **Forward Hostname / IP:** the VM's IP
- **Forward Port:** `8080` (or whatever `WEB_PORT` you chose in `.env`)
- **Block Common Exploits:** on
- **Websockets Support:** off (we don't use them yet)
- **SSL:** Request a Let's Encrypt cert; force SSL.

Set the same Forward Hostname for HTTPS that you put in `BETTER_AUTH_URL`.

### 7. Verify auto-redeploy

Push any change to `main` (e.g. a comment in a README). Within 5–10
minutes, Watchtower pulls the new tag and recreates `app` and `web`. Tail
its logs to confirm:

```sh
docker compose logs -f watchtower
```

---

## Rollback

Image tags include `sha-<short>` for every commit. To pin to an earlier
build:

```sh
# in /srv/projectproject/.env
IMAGE_TAG=sha-abc1234

# then
docker compose up -d
```

Disable Watchtower while pinned, or it'll roll you forward to `latest` on
the next poll:

```sh
docker compose stop watchtower
```

When you want to re-track latest:

```sh
# remove IMAGE_TAG from .env
docker compose up -d
docker compose start watchtower
```

---

## Private image notes

The GitHub Actions workflow pushes to `ghcr.io/<owner>/projectproject-{app,web}`.
Public visibility is per-package:

1. After the first successful CI run, go to your GitHub profile → Packages.
2. For each of `projectproject-app` and `projectproject-web`, open
   _Package settings → Change visibility → Public_.

If you'd rather keep them private, create a Personal Access Token
(`read:packages` scope), and set up Docker auth on the VM:

```sh
echo "<PAT>" | docker login ghcr.io -u <owner> --password-stdin
```

That writes `~/.docker/config.json`. To let Watchtower use the same
credentials, either uncomment the docker-config bind-mount in
`compose.yaml` and copy the file to `/srv/projectproject/docker-config.json`,
or run Watchtower under a user whose `~/.docker/config.json` is the same
file.

---

## Troubleshooting

**The app starts before Postgres is ready.**
The `migrations` service has `depends_on: postgres` with
`condition: service_healthy`. If you see migrations crashing on connect,
inspect Postgres' health: `docker compose ps postgres`.

**Watchtower never picks up new images.**
Check the labels: only services with `com.centurylinklabs.watchtower.enable=true`
are watched (we set this on `app` and `web`). `WATCHTOWER_LABEL_ENABLE`
must be `"true"`. Verify with `docker compose logs watchtower`.

**OAuth callback fails after deploy.**
`BETTER_AUTH_URL` in `.env` must match the public HTTPS hostname _exactly_,
including the scheme (`https://`). The GitHub OAuth app's callback URL must
be `<BETTER_AUTH_URL>/api/auth/callback/github`.

**Migrations keep running on every redeploy.**
That's intended — Drizzle's `migrate` is idempotent. Each migration is
applied once based on its name; subsequent runs no-op.

## IGNE deployment: TLS and image-owned routes

`pp.igne.nl` terminates origin TLS in the frontend container. Its host-mounted
`/srv/projectproject/nginx/default.conf` defines the HTTP redirect and HTTPS
server, loads certificates from `/etc/nginx/certs`, sets the static root to
`/usr/share/nginx/html`, and includes `/etc/nginx/app.locations` inside the HTTPS
server block.

Application routes belong to the image: `docker/nginx.locations` is copied to
`/etc/nginx/app.locations`. Both the default HTTP server and the IGNE HTTPS
server use that include. Do not mount a host copy of `app.locations`; it would
hide routing changes shipped in later images, including OAuth discovery routes.

### One-time migration of existing IGNE containers

Only perform this after an image containing `docker/nginx.locations` has been
published. The old image does not provide the include on its own.

1. Back up `/srv/projectproject/compose.override.yaml` and
   `/srv/projectproject/nginx/`.
2. Pull the new web image and verify it contains `/etc/nginx/app.locations`.
3. Remove this volume from the host's `compose.override.yaml`:

   ```yaml
   - /srv/projectproject/nginx/app.locations:/etc/nginx/app.locations:ro
   ```

   Keep the TLS `default.conf` and certificate mounts. The host's `default.conf`
   must still include `/etc/nginx/app.locations` inside its HTTPS server block.
4. Validate the merged configuration using the new image and recreate only web:

   ```sh
   cd /srv/projectproject
   docker compose pull web
   docker compose run --rm --no-deps web nginx -t
   docker compose up -d --no-deps web
   docker compose exec web nginx -t
   ```

5. Verify `https://pp.igne.nl/.well-known/oauth-protected-resource/mcp` returns
   `application/json` with resource `https://pp.igne.nl/mcp`, authorization-server
   discovery returns JSON, `/mcp` returns an authentication challenge without a
   token, and the frontend still loads.

Watchtower updates images, not host-mounted configuration. This one-time mount
removal allows future route updates to travel with the image. To roll back to an
older image without the include, restore the backed-up volume mount as well.
