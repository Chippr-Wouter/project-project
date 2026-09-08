import { chmod, readFile, writeFile } from "node:fs/promises"
import pg from "pg"

const FIXTURE = {
  host: "127.0.0.1",
  port: 55439,
  database: "measure",
  organizationId: "measure-org",
  organizationSlug: "measure",
  projectSlug: "ten-thousand",
  projectId: "00000000-0000-4000-8000-000000000010",
  ownerId: "measure-user",
  ownerSessionId: "measure-session",
  lifecycleUserId: "prototype-lifecycle-user",
  lifecycleEmail: "prototype-lifecycle-account@example.test",
  lifecycleUsername: "prototype-lifecycle",
  lifecycleMemberId: "prototype-lifecycle-member",
  lifecycleSessionId: "prototype-lifecycle-session",
  cookieName: "better-auth.session_token"
}

const args = new Set(process.argv.slice(2))
const cleanup = args.has("--cleanup")
const databaseUrl = process.env.PROTOTYPE_DATABASE_URL
const envFile =
  valueAfter("--env-file") ?? "/tmp/pp-overview-10k/lifecycle-proxy.env"
const stateFile =
  valueAfter("--state-file") ??
  "/tmp/pp-overview-10k/lifecycle-fixture-state.json"

if (!databaseUrl) {
  throw new Error("Set PROTOTYPE_DATABASE_URL to the disposable database")
}
assertDisposableDatabase(databaseUrl)
if (
  !cleanup &&
  !process.env.PROTOTYPE_AUTH_SECRET &&
  !process.env.BETTER_AUTH_SECRET &&
  (!process.env.PROTOTYPE_COOKIE_A || !process.env.PROTOTYPE_COOKIE_B)
) {
  throw new Error(
    "Set PROTOTYPE_AUTH_SECRET or provide both prototype session cookies before mutating the fixture"
  )
}

const client = new pg.Client({ connectionString: databaseUrl })
await client.connect()
try {
  if (cleanup) {
    await restoreFixture(client, stateFile)
  } else {
    await setupFixture(client, stateFile, envFile)
  }
} finally {
  await client.end()
}

function valueAfter(name) {
  const argument = process.argv.find((value) => value.startsWith(`${name}=`))
  return argument?.slice(name.length + 1)
}

function assertDisposableDatabase(rawUrl) {
  let url
  try {
    url = new URL(rawUrl)
  } catch {
    throw new Error("PROTOTYPE_DATABASE_URL must be a valid URL")
  }
  if (!["127.0.0.1", "localhost"].includes(url.hostname))
    throw new Error("Refusing a non-local prototype database")
  if (Number(url.port || 5432) !== FIXTURE.port)
    throw new Error(
      `Refusing database port ${url.port || 5432}; expected ${FIXTURE.port}`
    )
  if (decodeURIComponent(url.pathname.slice(1)) !== FIXTURE.database)
    throw new Error(
      `Refusing database ${url.pathname}; expected /${FIXTURE.database}`
    )
  if (!["measure", "usermeasure"].includes(decodeURIComponent(url.username)))
    throw new Error("Refusing an unexpected prototype database user")
}

async function setupFixture(db, previousStatePath, proxyEnvPath) {
  await db.query("BEGIN")
  try {
    const fixture = await verifyFixture(db)
    const existing = await readExistingLifecycleRows(db)
    const managedState = await readManagedState(previousStatePath)
    if (
      !managedState &&
      (existing.lifecycleUser ||
        existing.lifecycleMember ||
        existing.lifecycleProjectMember ||
        existing.lifecycleSession)
    )
      throw new Error("Prototype lifecycle rows exist without their state file")
    const ownerSessionToken = existing.ownerSession.token
    const previousState = managedState ?? {
      version: 1,
      database: databaseFingerprint(databaseUrl),
      fixture,
      managedLifecycleUser: true,
      ownerSession: withoutToken(existing.ownerSession),
      lifecycleUser: null,
      lifecycleMember: null,
      lifecycleProjectMember: null,
      lifecycleSession: null
    }
    if (previousState.database !== databaseFingerprint(databaseUrl))
      throw new Error(
        "Fixture state does not belong to this disposable database"
      )
    if (previousState.managedLifecycleUser !== true)
      throw new Error("Fixture state does not own the prototype lifecycle user")

    await assertNoIdentityCollision(existing.lifecycleUser)
    await assertNoMembershipCollision(existing.lifecycleMember)
    await upsertLifecycleUser(db)
    await upsertLifecycleOrgMember(db)
    await upsertLifecycleProjectMember(db, fixture.project.id)
    await renewOwnerSession(db)
    const lifecycleToken = await upsertLifecycleSession(db)
    await writeState(previousStatePath, previousState)
    await db.query("COMMIT")

    await writeProxyEnv(proxyEnvPath, ownerSessionToken, lifecycleToken)
    process.stdout.write(
      `[lifecycle-fixture] ready for ${FIXTURE.organizationSlug}/${FIXTURE.projectSlug}; env written to ${proxyEnvPath}\n`
    )
  } catch (error) {
    await db.query("ROLLBACK")
    throw error
  }
}

async function restoreFixture(db, previousStatePath) {
  const state = JSON.parse(await readFile(previousStatePath, "utf8"))
  if (
    state.version !== 1 ||
    state.database !== databaseFingerprint(databaseUrl) ||
    state.managedLifecycleUser !== true
  )
    throw new Error("Fixture state does not belong to this disposable database")

  await db.query("BEGIN")
  try {
    const existing = {
      lifecycleUser: await maybeOne(
        db,
        'SELECT id, email, username FROM "user" WHERE id=$1',
        [FIXTURE.lifecycleUserId]
      ),
      lifecycleMember: await maybeOne(
        db,
        "SELECT id, organization_id, user_id, role FROM member WHERE id=$1",
        [FIXTURE.lifecycleMemberId]
      ),
      lifecycleProjectMember: await maybeOne(
        db,
        "SELECT project_slug, project_id, user_id, role FROM project_member WHERE project_slug=$1 AND user_id=$2",
        [FIXTURE.projectSlug, FIXTURE.lifecycleUserId]
      ),
      lifecycleSession: await maybeOne(
        db,
        "SELECT id, user_id FROM session WHERE id=$1",
        [FIXTURE.lifecycleSessionId]
      )
    }
    await assertOwnedLifecycleRows(existing)
    await db.query("DELETE FROM session WHERE user_id=$1", [
      FIXTURE.lifecycleUserId
    ])
    await db.query(
      "DELETE FROM project_member WHERE project_slug=$1 AND user_id=$2",
      [FIXTURE.projectSlug, FIXTURE.lifecycleUserId]
    )
    await db.query(
      "DELETE FROM member WHERE id=$1 AND user_id=$2 AND organization_id=$3",
      [
        FIXTURE.lifecycleMemberId,
        FIXTURE.lifecycleUserId,
        FIXTURE.organizationId
      ]
    )
    await db.query(
      'DELETE FROM "user" WHERE id=$1 AND email=$2 AND username=$3',
      [
        FIXTURE.lifecycleUserId,
        FIXTURE.lifecycleEmail,
        FIXTURE.lifecycleUsername
      ]
    )

    if (state.ownerSession) {
      await db.query(
        "UPDATE session SET expires_at=$1, updated_at=$2, active_organization_id=$3 WHERE id=$4 AND user_id=$5",
        [
          state.ownerSession.expires_at,
          state.ownerSession.updated_at,
          state.ownerSession.active_organization_id,
          FIXTURE.ownerSessionId,
          FIXTURE.ownerId
        ]
      )
    }
    await db.query("COMMIT")
    process.stdout.write(
      "[lifecycle-fixture] disposable account removed and owner session restored\n"
    )
  } catch (error) {
    await db.query("ROLLBACK")
    throw error
  }
}

async function readManagedState(path) {
  try {
    const state = JSON.parse(await readFile(path, "utf8"))
    if (state?.version !== 1 || state?.managedLifecycleUser !== true)
      throw new Error("Fixture state is not managed by this script")
    return state
  } catch (error) {
    if (error?.code === "ENOENT") return null
    throw error
  }
}

async function writeState(path, state) {
  await writeFile(path, `${JSON.stringify(state, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600
  })
  await chmod(path, 0o600)
}

async function verifyFixture(db) {
  const organization = await one(
    db,
    "SELECT id, slug FROM organization WHERE id=$1 AND slug=$2",
    [FIXTURE.organizationId, FIXTURE.organizationSlug],
    "fixture organization"
  )
  const project = await one(
    db,
    "SELECT id, slug, organization_id FROM project_index WHERE slug=$1",
    [FIXTURE.projectSlug],
    "fixture project"
  )
  if (
    project.id !== FIXTURE.projectId ||
    project.organization_id !== FIXTURE.organizationId
  )
    throw new Error(
      "Fixture project identity does not match the known markdown fixture"
    )
  const ownerOrgMember = await one(
    db,
    "SELECT id, role FROM member WHERE organization_id=$1 AND user_id=$2",
    [FIXTURE.organizationId, FIXTURE.ownerId],
    "fixture owner organization membership"
  )
  const ownerProjectMember = await one(
    db,
    "SELECT project_slug, project_id, role FROM project_member WHERE project_slug=$1 AND user_id=$2",
    [FIXTURE.projectSlug, FIXTURE.ownerId],
    "fixture owner project membership"
  )
  if (ownerOrgMember.role !== "owner" || ownerProjectMember.role !== "owner")
    throw new Error("Fixture owner membership changed unexpectedly")
  if (ownerProjectMember.project_id !== FIXTURE.projectId)
    throw new Error(
      "Fixture owner project membership points at another project"
    )
  return { organization, project }
}

async function readExistingLifecycleRows(db) {
  const lifecycleUser = await maybeOne(
    db,
    'SELECT id, name, email, username, email_verified, last_active_organization_id FROM "user" WHERE id=$1 OR email=$2 OR username=$3',
    [FIXTURE.lifecycleUserId, FIXTURE.lifecycleEmail, FIXTURE.lifecycleUsername]
  )
  const lifecycleMember = await maybeOne(
    db,
    "SELECT id, organization_id, user_id, role, created_at FROM member WHERE id=$1",
    [FIXTURE.lifecycleMemberId]
  )
  const lifecycleProjectMember = await maybeOne(
    db,
    "SELECT project_slug, project_id, user_id, role, created_at FROM project_member WHERE project_slug=$1 AND user_id=$2",
    [FIXTURE.projectSlug, FIXTURE.lifecycleUserId]
  )
  const ownerSession = await maybeOne(
    db,
    "SELECT id, user_id, token, expires_at, updated_at, active_organization_id FROM session WHERE id=$1",
    [FIXTURE.ownerSessionId]
  )
  if (!ownerSession || ownerSession.user_id !== FIXTURE.ownerId)
    throw new Error(
      "The known disposable owner session is missing or belongs to another user"
    )
  const lifecycleSession = await maybeOne(
    db,
    "SELECT id, user_id, token, expires_at, created_at, updated_at, active_organization_id FROM session WHERE id=$1",
    [FIXTURE.lifecycleSessionId]
  )
  return {
    lifecycleUser,
    lifecycleMember,
    lifecycleProjectMember,
    ownerSession,
    lifecycleSession
  }
}

async function assertNoIdentityCollision(row) {
  if (!row) return
  if (
    row.id !== FIXTURE.lifecycleUserId ||
    row.email !== FIXTURE.lifecycleEmail ||
    row.username !== FIXTURE.lifecycleUsername
  ) {
    throw new Error(
      "Prototype lifecycle identity collides with an existing user"
    )
  }
}

async function assertNoMembershipCollision(row) {
  if (
    row &&
    (row.user_id !== FIXTURE.lifecycleUserId ||
      row.organization_id !== FIXTURE.organizationId)
  )
    throw new Error("Prototype lifecycle membership id belongs to another user")
}

async function assertOwnedLifecycleRows(rows) {
  await assertNoIdentityCollision(rows.lifecycleUser)
  await assertNoMembershipCollision(rows.lifecycleMember)
  if (
    rows.lifecycleProjectMember &&
    rows.lifecycleProjectMember.user_id !== FIXTURE.lifecycleUserId
  )
    throw new Error(
      "Prototype lifecycle project membership belongs to another user"
    )
  if (
    rows.lifecycleSession &&
    rows.lifecycleSession.user_id !== FIXTURE.lifecycleUserId
  )
    throw new Error("Prototype lifecycle session belongs to another user")
}

async function upsertLifecycleUser(db) {
  await db.query(
    'INSERT INTO "user" (id, name, email, email_verified, username, last_active_organization_id) VALUES ($1,$2,$3,true,$4,$5) ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, email=EXCLUDED.email, email_verified=true, username=EXCLUDED.username, last_active_organization_id=EXCLUDED.last_active_organization_id, updated_at=NOW()',
    [
      FIXTURE.lifecycleUserId,
      "Prototype Lifecycle User",
      FIXTURE.lifecycleEmail,
      FIXTURE.lifecycleUsername,
      FIXTURE.organizationId
    ]
  )
}

async function upsertLifecycleOrgMember(db) {
  const existing = await db.query(
    "SELECT id, role FROM member WHERE organization_id=$1 AND user_id=$2",
    [FIXTURE.organizationId, FIXTURE.lifecycleUserId]
  )
  if (existing.rows.length > 1)
    throw new Error("Prototype lifecycle user has duplicate org memberships")
  if (existing.rows[0] && existing.rows[0].id !== FIXTURE.lifecycleMemberId)
    throw new Error("Prototype lifecycle org membership has an unexpected id")
  await db.query(
    "INSERT INTO member (id, organization_id, user_id, role, created_at) VALUES ($1,$2,$3,'member',NOW()) ON CONFLICT (id) DO UPDATE SET organization_id=EXCLUDED.organization_id, user_id=EXCLUDED.user_id, role='member'",
    [FIXTURE.lifecycleMemberId, FIXTURE.organizationId, FIXTURE.lifecycleUserId]
  )
}

async function upsertLifecycleProjectMember(db, projectId) {
  await db.query(
    "INSERT INTO project_member (project_slug, project_id, user_id, role, created_at) VALUES ($1,$2,$3,'member',NOW()) ON CONFLICT (project_slug,user_id) DO UPDATE SET project_id=EXCLUDED.project_id, role='member'",
    [FIXTURE.projectSlug, projectId, FIXTURE.lifecycleUserId]
  )
}

async function renewOwnerSession(db) {
  await db.query(
    "UPDATE session SET expires_at=$1, updated_at=NOW(), active_organization_id=$2 WHERE id=$3 AND user_id=$4",
    [
      futureExpiry(),
      FIXTURE.organizationId,
      FIXTURE.ownerSessionId,
      FIXTURE.ownerId
    ]
  )
}

async function upsertLifecycleSession(db) {
  const existing = await maybeOne(
    db,
    "SELECT id, user_id, token FROM session WHERE id=$1",
    [FIXTURE.lifecycleSessionId]
  )
  if (existing && existing.user_id !== FIXTURE.lifecycleUserId)
    throw new Error("Prototype lifecycle session id belongs to another user")
  const token = existing?.token ?? `prototype-lifecycle-${crypto.randomUUID()}`
  await db.query(
    "INSERT INTO session (id, expires_at, token, created_at, updated_at, user_id, active_organization_id) VALUES ($1,$2,$3,NOW(),NOW(),$4,$5) ON CONFLICT (id) DO UPDATE SET expires_at=EXCLUDED.expires_at, updated_at=NOW(), user_id=EXCLUDED.user_id, active_organization_id=EXCLUDED.active_organization_id",
    [
      FIXTURE.lifecycleSessionId,
      futureExpiry(),
      token,
      FIXTURE.lifecycleUserId,
      FIXTURE.organizationId
    ]
  )
  await db.query("DELETE FROM session WHERE user_id=$1 AND id<>$2", [
    FIXTURE.lifecycleUserId,
    FIXTURE.lifecycleSessionId
  ])
  return token
}

async function writeProxyEnv(path, ownerToken, lifecycleToken) {
  const secret =
    process.env.PROTOTYPE_AUTH_SECRET ?? process.env.BETTER_AUTH_SECRET
  const ownerCookie = normalizeCookie(process.env.PROTOTYPE_COOKIE_A)
  const lifecycleCookie = normalizeCookie(process.env.PROTOTYPE_COOKIE_B)
  const signedOwnerCookie =
    cookieToken(ownerCookie) === ownerToken
      ? ownerCookie
      : secret
        ? await signedCookie(ownerToken, secret)
        : null
  const signedLifecycleCookie =
    cookieToken(lifecycleCookie) === lifecycleToken
      ? lifecycleCookie
      : secret
        ? await signedCookie(lifecycleToken, secret)
        : null
  if (!signedOwnerCookie || !signedLifecycleCookie)
    throw new Error(
      "Set PROTOTYPE_COOKIE_A or PROTOTYPE_AUTH_SECRET to write fixture cookies"
    )

  const output = [
    `PROTOTYPE_COOKIE=${signedOwnerCookie}`,
    `PROTOTYPE_COOKIE_A=${signedOwnerCookie}`,
    `PROTOTYPE_COOKIE_B=${signedLifecycleCookie}`,
    "PROTOTYPE_DEFAULT_IDENTITY=a",
    "PROTOTYPE_BACKEND_PORT=3110",
    "PROTOTYPE_BACKEND_ORIGIN=http://localhost:3000",
    "PROTOTYPE_LIFECYCLE_HARNESS=true",
    "PROTOTYPE_ALLOW_AUTH_WRITES=true",
    "PROTOTYPE_ALLOW_TICKET_WRITES=false",
    ""
  ].join("\n")
  await writeFile(path, output, { encoding: "utf8", mode: 0o600 })
  await chmod(path, 0o600)
}

function normalizeCookie(raw) {
  if (!raw) return null
  const first = raw.split(";")[0].trim()
  const value = first.startsWith(`${FIXTURE.cookieName}=`)
    ? first.slice(FIXTURE.cookieName.length + 1)
    : first.includes("=")
      ? null
      : first
  if (value !== null) {
    const decoded = decodeURIComponent(value)
    if (!decoded.includes("."))
      throw new Error("Prototype cookie must contain a signed session token")
    return `${FIXTURE.cookieName}=${encodeURIComponent(decoded)}`
  }
  throw new Error("Prototype cookie must be a better-auth session cookie")
}

function cookieToken(cookie) {
  if (!cookie) return null
  const value = decodeURIComponent(cookie.slice(FIXTURE.cookieName.length + 1))
  return value.slice(0, value.lastIndexOf("."))
}

async function signedCookie(token, secret) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  )
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(token)
  )
  return `${FIXTURE.cookieName}=${encodeURIComponent(`${token}.${btoa(String.fromCharCode(...new Uint8Array(signature)))}`)}`
}

function futureExpiry() {
  return new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
}

function databaseFingerprint(rawUrl) {
  const url = new URL(rawUrl)
  return `${url.protocol}//${url.hostname}:${url.port || 5432}/${decodeURIComponent(url.pathname.slice(1))}`
}

function withoutToken(session) {
  if (!session) return null
  const { token, ...safeSession } = session
  return safeSession
}

async function maybeOne(db, text, values) {
  const result = await db.query(text, values)
  if (result.rows.length > 1)
    throw new Error("Expected at most one fixture row")
  return result.rows[0] ?? null
}

async function one(db, text, values, label) {
  const row = await maybeOne(db, text, values)
  if (!row) throw new Error(`Missing ${label}`)
  return row
}
