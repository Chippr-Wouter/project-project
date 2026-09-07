import { mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

const outdir = await mkdtemp(join(tmpdir(), "pp-indexeddb-prototype-"))
const build = await Bun.build({
  entrypoints: [join(import.meta.dir, "ticket-indexeddb-prototype.ts")],
  outdir,
  target: "browser",
  minify: true
})
if (!build.success)
  throw new AggregateError(build.logs, "Prototype build failed")

Bun.serve({
  hostname: "127.0.0.1",
  port: 4187,
  fetch(request) {
    const url = new URL(request.url)
    if (url.pathname === "/prototype.js") return new Response(build.outputs[0])
    if (url.pathname !== "/") return new Response("Not found", { status: 404 })
    return new Response(
      `<!doctype html><html><head><meta charset="utf-8"><title>Ticket IndexedDB prototype</title></head><body><pre id="output">Running isolated IndexedDB checks…</pre><script type="module" src="/prototype.js"></script></body></html>`,
      {
        headers: { "Content-Type": "text/html" }
      }
    )
  }
})
console.log(
  "IndexedDB prototype: http://127.0.0.1:4187 — reload to verify persistence"
)
