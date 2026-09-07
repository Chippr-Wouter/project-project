import assert from "node:assert/strict"
import pg from "pg"

if (!process.env.PROTOTYPE_COOKIE)
  throw new Error("Set PROTOTYPE_COOKIE for the disposable fixture")
const url = "postgres://measure:measure-local@127.0.0.1:55439/measure"
const a = new pg.Client({ connectionString: url })
const b = new pg.Client({ connectionString: url })
await a.connect()
await b.connect()
const project = "00000000-0000-4000-8000-000000000010"
const head = async (client) =>
  (
    await client.query(
      "select epoch, revision from prototype_ticket_sync_head where project_id=$1",
      [project]
    )
  ).rows[0]
const update = (client, id, title) =>
  client.query(
    "update ticket_index set title=$1 where project_id=$2 and ticket_id=$3",
    [title, project, id]
  )
const request = async (path) => {
  const response = await fetch(
    "http://localhost:3110/api/orgs/measure/projects/ten-thousand/tickets/" +
      path,
    { headers: { cookie: process.env.PROTOTYPE_COOKIE } }
  )
  assert.equal(response.status, 200)
  return response.json()
}
const delta = (checkpoint) =>
  request("prototype-sync-delta?" + new URLSearchParams(checkpoint))
const original = (
  await a.query(
    "select ticket_id, title from ticket_index where project_id=$1 and ticket_id in ('T-9997','T-9994')",
    [project]
  )
).rows
const checks = []
try {
  const start = await head(a)
  await a.query("begin")
  await update(a, "T-9997", "Rollback probe")
  await a.query("rollback")
  assert.deepEqual(await head(a), start)
  checks.push("Failed transaction leaves checkpoint unchanged")

  await a.query("begin")
  await update(a, "T-9997", "First commit")
  await b.query("begin")
  let secondFinished = false
  const second = update(b, "T-9994", "Second commit").then(() => {
    secondFinished = true
  })
  await new Promise((resolve) => setTimeout(resolve, 100))
  assert.equal(secondFinished, false)
  await a.query("commit")
  await second
  await b.query("commit")
  const ordered = await delta(start)
  assert.equal(ordered.checkpoint.revision, start.revision + 2)
  assert.deepEqual(
    new Set(ordered.items.map((t) => t.id)),
    new Set(["T-9997", "T-9994"])
  )
  checks.push(
    "Overlapping writers serialize checkpoint assignment through commit"
  )

  await a.query("begin isolation level repeatable read read only")
  const boundary = await head(a)
  await update(b, "T-9997", "After snapshot boundary")
  const snapshotRow = (
    await a.query(
      "select title from ticket_index where project_id=$1 and ticket_id='T-9997'",
      [project]
    )
  ).rows[0]
  assert.equal(snapshotRow.title, "First commit")
  await a.query("commit")
  const catchup = await delta(boundary)
  assert.equal(
    catchup.items.find((t) => t.id === "T-9997").title,
    "After snapshot boundary"
  )
  checks.push("Write after snapshot boundary is delivered by delta")

  const beforePages = await head(a)
  await a.query("begin")
  for (let i = 0; i < 1001; i++) await update(a, "T-9997", "Page probe " + i)
  await a.query("commit")
  const firstPage = await delta(beforePages)
  assert.equal(firstPage.hasMore, true)
  assert.equal(firstPage.checkpoint.revision, beforePages.revision + 1000)
  const lastPage = await delta(firstPage.checkpoint)
  assert.equal(lastPage.hasMore, false)
  assert.equal(lastPage.checkpoint.revision, beforePages.revision + 1001)
  assert.equal(lastPage.items[0].title, "Page probe 1000")
  checks.push("Bounded delta pages advance without skipping revisions")

  const reset = await delta({ epoch: "unknown", revision: 0 })
  assert.equal(reset.reset, true)
  const snap = await request("prototype-sync-snapshot")
  assert.deepEqual(snap.checkpoint, await head(a))
  assert.equal(
    snap.items.find((t) => t.id === "T-9997").title,
    "Page probe 1000"
  )
  checks.push(
    "Unknown epoch requests reset; snapshot includes current checkpoint and data"
  )
} finally {
  await a.query("rollback")
  await b.query("rollback")
  for (const row of original) await update(a, row.ticket_id, row.title)
  await a.end()
  await b.end()
}
console.log(JSON.stringify({ passed: true, checks }, null, 2))
