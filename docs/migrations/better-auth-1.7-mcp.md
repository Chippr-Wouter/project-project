# Better Auth 1.7 MCP/OAuth migration

This deployment moves the MCP authorization provider from the old Better Auth MCP tables and handler to Better Auth 1.7's `@better-auth/mcp` and OAuth provider tables.

## What the migration does

The migration `20260907091000_better_auth_17` creates the provider tables (`oauth_client`, `oauth_client_resource`, `oauth_provider_access_token`, `oauth_provider_consent`, `oauth_refresh_token`, `oauth_resource`, and supporting JWKS/assertion tables). It copies legacy `oauth_application` records into `oauth_client` records. Existing client secrets are copied as the provider's hashed secret; a legacy application without a secret is copied with the `none` token endpoint authentication method. Redirect URLs, client metadata, timestamps, and disabled state are preserved. The new records enable authorization-code and refresh-token grants, code responses, and mandatory PKCE.

After the provider seeds the configured MCP resource, auth initialization links migrated clients to it. The backfill matches both the legacy row ID and client ID and leaves existing mappings unchanged, so repeated starts are safe. Per-client resource enforcement stays enabled.

Legacy OAuth tables are retained. They are not dropped by this migration, so rollback inspection and historical data remain possible. New runtime reads and revocation operate on the new provider tables.

Existing access and refresh tokens are expired during the migration. Legacy consent rows are not migrated into the new provider consent records. Users must authorize each MCP client again after deployment. Revocation removes the new user's refresh tokens, access tokens, and consent for that client while retaining the registered client record.

Tokens carry only the authenticated client’s consent record IDs present when they were issued. The MCP handler requires a matching persisted consent for the authenticated user and client on every request. Reconnecting creates a new consent, so it cannot restore access to an old revoked token.

## Client impact

MCP clients should rediscover the authorization server and protected resource from the root `/.well-known/` endpoints. The OAuth endpoints are under `/api/auth/oauth2/*` behind the application origin. Authorization redirects use the frontend consent and login pages and preserve the complete signed query string.

Legacy confidential clients receive a hashed secret in the new client record and continue with `client_secret_basic` when their old record had a secret. Legacy public clients whose old schema did not carry an explicit authentication method may not satisfy the new provider's client authentication requirements. Re-register those clients if token exchange or refresh is rejected; do not copy a new secret into a public client as a workaround.

Because old access tokens are expired and old consents are absent, a successful client migration still requires a fresh login and consent. Clients should handle a 401 by restarting OAuth discovery and authorization rather than retrying an old token.

## Operational sequence

1. Back up the database and apply the timestamped Drizzle history, including `20260907091000_better_auth_17`.
2. Deploy the matching backend and frontend together so root discovery, signed-query consent, and v1.7 OAuth endpoints agree.
3. Ask existing MCP users to authorize their clients again. Confirm one new `oauth_client` and user-scoped `oauth_provider_consent` record exists for a migrated client.
4. Verify a newly issued token against the configured MCP resource and verify that deleting the user's application removes the user's provider consent and token rows while leaving `oauth_client` intact.
5. Keep the legacy tables until the migration has been observed and rollback requirements have been cleared.

The compatibility tests are isolated by design. Set `PROJECTPROJECT_TEST_DATABASE_URL` only to a local database whose name begins with `projectproject_effect_v4_`, then run `bun run test:db`. Without that variable the tests are skipped. Never use a production or shared database for this check.
