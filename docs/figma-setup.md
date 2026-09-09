# Figma integration setup

Paste a Figma link into a ticket description and it becomes a chip that expands
into a live embed. Behind that, ProjectProject resolves the frame name, caches a
thumbnail, and writes the ticket URL back onto the Figma node as a Dev Mode
resource.

None of that works until a Figma OAuth app exists and the environment knows
about it. This page is the whole setup.

## 1. Create the OAuth app

At <https://www.figma.com/developers/apps>, click **Create a new app** and
associate it with the **team**, not a personal account — Figma lets admins
reassign a team-owned app when someone leaves, and a personally-owned app walks
out of the door with them.

A **private** app is enough. Private apps are usable across your team with no
Figma review, no 512×512 logo, and no submission process. Public apps need all
three, and are only relevant if ProjectProject is ever offered to outside teams.

## 2. Enable the scopes

**This is the step people miss.** The scope picker does not default to what you
need, and requesting a scope the app does not have fails the authorization with:

```
{"error":true,"status":400,"message":"Invalid scopes for app","i18n":null}
```

Enable all five:

| Scope | What breaks without it |
| --- | --- |
| `current_user:read` | The OAuth callback fails outright — we cannot read who connected |
| `file_content:read` | Frame names never resolve; chips stay on URL slugs |
| `file_metadata:read` | File names and last-modified never resolve |
| `file_dev_resources:read` | Existing backlinks cannot be read |
| `file_dev_resources:write` | No Dev Mode backlink — the ticket never appears on the frame |

All five are available on every Figma plan. Figma accepts either a
space-separated or comma-separated `scope` parameter; we send space-separated.

`file_dev_resources:write` is the only *write* scope. Dropping it degrades the
feature to a link previewer but nothing else breaks, so it is a reasonable thing
to withhold if write access to design files is not acceptable.

## 3. Register the redirect URLs

Figma allowlists exact strings and refuses token exchange for anything not
registered. Add **both**, or local development fails at the callback:

```
http://localhost:5173/api/integrations/figma/oauth/callback
https://<your-public-host>/api/integrations/figma/oauth/callback
```

The host is whatever `BETTER_AUTH_URL` is set to — the **frontend** origin
(5173 in development), not the backend's 3000. Match scheme exactly and use no
trailing slash.

If you want prototype embeds to render, also register your allowed **embed
origins** on the same app.

## 4. Set the environment variables

```
FIGMA_CLIENT_ID=
FIGMA_CLIENT_SECRET=
```

Locally these live in `.env`. In production the compose file reads
`env_file: /srv/projectproject/.env` on the host, so they must be added to that
file on the server — nothing in the repo does it for you, and the failure mode
is Figma silently unavailable in production while working perfectly locally.

Both are documented in [`.env.example`](../.env.example) and
[`.env.production.example`](../.env.production.example).

## 5. Run the migrations

The integration adds `user_figma_integration`, `user_figma_oauth_state`,
`project_figma_integration`, `figma_link_index`, and `figma_reference`. If they
are missing, the profile settings section returns a 500:

```bash
bun run --cwd packages/backend db:migrate
```

## Two kinds of connection

There are deliberately two, and they use different credential types.

**Personal (OAuth).** Each person can connect their own Figma account from
profile settings. This does not affect ticket metadata or provide per-user
Figma reads yet; reconciliation continues to use the project credential.

**Project (personal access token).** A scoped Figma PAT pasted into project
settings, used for everyone on the project — including background work like
reconciliation, which runs with no user present. Generate one at
**Figma → Account Settings → Security → Generate new token**, scoped to the five
scopes above.

They are different credential types on purpose. **Figma keeps only one access
token per app per user, and refreshing invalidates the previous one.** If the
same account backed both a personal OAuth connection and the project connection
through the same app, the second would silently invalidate the first, surfacing
as intermittent authentication failures from whichever seam refreshed last. A
PAT is independent of the OAuth app and cannot collide.

When both exist, the personal connection wins.

## Object storage is a precondition

A project cannot connect Figma until org object storage is connected — project
settings will say so and disable the control. Cached thumbnails live in that
bucket, and requiring it keeps behaviour uniform: every Figma link looks the
same in every project that has the integration at all, rather than degrading
silently per-project.

## Token lifetimes

OAuth access tokens last **90 days** and refresh automatically. The project PAT
has whatever expiry you gave it and **does not renew** — when it lapses, designs
stop resolving. The failure is soft (chips fall back to their URL-slug name) and
surfaces in project settings as an authentication error, but it is worth setting
an expiry you will remember.

## Troubleshooting

| Symptom | Cause |
| --- | --- |
| `Invalid scopes for app` | A requested scope is not enabled on the app (step 2) |
| Callback fails at token exchange | Redirect URL not registered, or not an exact match (step 3) |
| Profile settings returns 500 | Migrations not applied (step 5) |
| Chips show URL slugs, never frame names | No connection resolves — check project settings, or the PAT expired |
| Connect button disabled in project settings | Org object storage is not connected |
| Embed shows Figma's no-access screen | The *viewer's* own Figma account cannot see that file; embeds use their session, not ours |
