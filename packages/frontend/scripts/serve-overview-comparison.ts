import { resolve, sep } from "node:path"

const [directory, port] = Bun.argv.slice(2)
if (!directory || !port || !Bun.env.PROTOTYPE_COOKIE) {
  throw new Error(
    "Usage: PROTOTYPE_COOKIE=... bun scripts/serve-overview-comparison.ts <dist> <port>"
  )
}
const root = resolve(directory)
const backendPort = Number(Bun.env.PROTOTYPE_BACKEND_PORT ?? 3109)
if (![3109, 3110].includes(backendPort))
  throw new Error("Expected a disposable backend port")
const instrumentation = `<script>
performance.setResourceTimingBufferSize(5000);
window.__overviewMeasure = { ready: null, longTasks: [] };
new PerformanceObserver(list => {
  window.__overviewMeasure.longTasks.push(...list.getEntries().map(e => ({start:e.startTime,duration:e.duration})));
}).observe({type:"longtask",buffered:true});
const observer = new MutationObserver(() => {
  const lists = [...document.querySelectorAll("[data-loaded-rows]")];
  if (lists.length !== 3 || !lists.every(x => Number(x.dataset.loadedRows)>0)) return;
  window.__overviewMeasure.ready = {
    ms:performance.now(),
    loaded:lists.map(x=>Number(x.dataset.loadedRows)),
    mounted:lists.map(x=>Number(x.dataset.mountedRows))
  };
  observer.disconnect();
});
observer.observe(document.documentElement,{childList:true,subtree:true,attributes:true});
</script>`

Bun.serve({
  hostname: "127.0.0.1",
  port: Number(port),
  async fetch(request) {
    const url = new URL(request.url)
    if (url.pathname.startsWith("/api/")) {
      if (request.method !== "GET")
        return new Response("Read-only fixture preview", { status: 405 })
      const headers = new Headers(request.headers)
      headers.set("cookie", Bun.env.PROTOTYPE_COOKIE!)
      headers.delete("host")
      return fetch(
        `http://127.0.0.1:${backendPort}${url.pathname}${url.search}`,
        {
          headers
        }
      )
    }
    const path = resolve(root, "." + decodeURIComponent(url.pathname))
    if (!path.startsWith(root + sep))
      return new Response("Not found", { status: 404 })
    const file = Bun.file(path)
    if (url.pathname !== "/" && (await file.exists())) return new Response(file)
    const html = await Bun.file(resolve(root, "index.html")).text()
    return new Response(html.replace("<head>", "<head>" + instrumentation), {
      headers: { "Content-Type": "text/html", "Cache-Control": "no-store" }
    })
  }
})
console.log(
  `Read-only comparison: http://localhost:${port}/orgs/measure/projects/ten-thousand`
)
