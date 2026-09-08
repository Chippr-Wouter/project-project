import { resolve, sep } from "node:path"

const [directory, port] = Bun.argv.slice(2)
const simulatedSignOuts = new Set<string>()
const cookies = new Map(
  Object.entries({
    default: Bun.env.PROTOTYPE_COOKIE,
    a: Bun.env.PROTOTYPE_COOKIE_A,
    b: Bun.env.PROTOTYPE_COOKIE_B
  }).filter((entry): entry is [string, string] => entry[1] !== undefined)
)
if (!directory || !port || cookies.size === 0) {
  throw new Error(
    "Usage: PROTOTYPE_COOKIE=... bun scripts/serve-overview-comparison.ts <dist> <port>"
  )
}
const root = resolve(directory)
const backendPort = Number(Bun.env.PROTOTYPE_BACKEND_PORT ?? 3109)
if (![3109, 3110].includes(backendPort))
  throw new Error("Expected a disposable backend port")
const defaultIdentity =
  Bun.env.PROTOTYPE_DEFAULT_IDENTITY ??
  (cookies.has("a") ? "a" : cookies.has("default") ? "default" : "b")
if (!cookies.has(defaultIdentity))
  throw new Error(`Unknown default prototype identity: ${defaultIdentity}`)
const identities = [...cookies.keys()]
const backendOrigin =
  Bun.env.PROTOTYPE_BACKEND_ORIGIN ?? "http://localhost:3000"
const lifecycleInstrumentation =
  Bun.env.PROTOTYPE_LIFECYCLE_HARNESS === "true"
    ? `(() => {
  const identityParam = "prototypeIdentity";
  const identityStorageKey = "__projectprojectPrototypeIdentity";
  const delayParam = "prototypeDelay";
  const delayedPaths = {
    snapshot: "/api/orgs/measure/projects/ten-thousand/tickets/prototype-sync-snapshot",
    delta: "/api/orgs/measure/projects/ten-thousand/tickets/prototype-sync-delta",
    me: "/api/me"
  };
  const allowedIdentities = new Set(${JSON.stringify(identities)});
  const url = new URL(location.href);
  const initialIdentity = url.searchParams.get(identityParam) ?? sessionStorage.getItem(identityStorageKey) ?? ${JSON.stringify(defaultIdentity)};
  const initialDelay = delayedPaths[url.searchParams.get(delayParam)];
  if (!allowedIdentities.has(initialIdentity)) throw new Error("Unknown prototype identity: " + initialIdentity);
  if (url.searchParams.get("prototypeNoBroadcast") === "1" && typeof window.BroadcastChannel === "function") {
    const OriginalBroadcastChannel = window.BroadcastChannel;
    window.BroadcastChannel = function(name) {
      const channel = new OriginalBroadcastChannel(name);
      return new Proxy(channel, {
        get(target, property, receiver) {
          if (property === "onmessage") return null;
          if (property === "addEventListener") return (type, listener, options) => {
            if (type === "message") return;
            return target.addEventListener(type, listener, options);
          };
          if (property === "removeEventListener") return (type, listener, options) => {
            if (type === "message") return;
            return target.removeEventListener(type, listener, options);
          };
          const value = Reflect.get(target, property, target);
          return typeof value === "function" ? value.bind(target) : value;
        },
        set(target, property, value, receiver) {
          if (property === "onmessage") return true;
          return Reflect.set(target, property, value, receiver);
        }
      });
    };
    window.BroadcastChannel.prototype = OriginalBroadcastChannel.prototype;
  }
  const identityHeader = "x-projectproject-prototype-identity";
  const originalFetch = window.fetch.bind(window);
  const network = {
    identity: initialIdentity,
    delayed: new Set(initialDelay === undefined ? [] : [initialDelay]),
    failures: new Set(),
    pending: [],
    requests: [],
    delay(path) { this.delayed.add(path); },
    clearDelayQuery() {
      const nextUrl = new URL(location.href);
      if (!nextUrl.searchParams.has(delayParam)) return;
      nextUrl.searchParams.delete(delayParam);
      history.replaceState(history.state, "", nextUrl);
    },
    release(path) {
      if (path === undefined) this.delayed.clear();
      else this.delayed.delete(path);
      if (path === undefined || path === initialDelay) this.clearDelayQuery();
      const selected = [];
      const remaining = [];
      for (const request of this.pending) {
        if (path === undefined || request.path === path) selected.push(request);
        else remaining.push(request);
      }
      this.pending = remaining;
      for (const request of selected) request.release();
    },
    pendingPaths() { return this.pending.map(request => request.path); },
    fail(path) { this.failures.add(path); },
    recover(path) { this.failures.delete(path); },
    setIdentity(nextIdentity) {
      if (!allowedIdentities.has(nextIdentity)) throw new Error("Unknown prototype identity: " + nextIdentity);
      this.identity = nextIdentity;
      window.__prototypeIdentity = nextIdentity;
      sessionStorage.setItem(identityStorageKey, nextIdentity);
      const nextUrl = new URL(location.href);
      nextUrl.searchParams.set(identityParam, nextIdentity);
      history.replaceState(history.state, "", nextUrl);
    }
  };
  const record = (entry) => {
    network.requests.push(entry);
    if (network.requests.length > 30) network.requests.shift();
  };
  window.__prototypeNetwork = network;
  window.__prototypeIdentity = initialIdentity;
  window.fetch = (input, init) => {
    const inputUrl = typeof input === "string" ? input : input instanceof Request ? input.url : input instanceof URL ? input.href : String(input);
    const requestUrl = new URL(inputUrl, location.href);
    if (requestUrl.origin !== location.origin) return originalFetch(input, init);
    const requestIdentity = network.identity;
    const headers = new Headers(input instanceof Request ? input.headers : undefined);
    if (init?.headers) new Headers(init.headers).forEach((value, key) => headers.set(key, value));
    headers.set(identityHeader, requestIdentity);
    const nextInit = init ? { ...init, headers } : { headers };
    const path = requestUrl.pathname;
    const method = (nextInit.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
    const startedAt = performance.now();
    if (network.failures.has(path)) {
      const error = new TypeError("Prototype transport failure");
      record({ path, method, identity: requestIdentity, status: "network-error", ms: 0 });
      return Promise.reject(error);
    }
    const run = () => originalFetch(input, nextInit).then(response => {
      record({ path, method, identity: requestIdentity, status: response.status, ms: performance.now() - startedAt });
      if (!network.delayed.has(path)) return response;
      return new Promise(resolve => {
        network.pending.push({ path, release: () => resolve(response) });
      });
    });
    return run();
  };
})();`
    : ""
const instrumentation = `<script>
${lifecycleInstrumentation}
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
    const identity =
      request.headers.get("x-projectproject-prototype-identity") ??
      url.searchParams.get("prototypeIdentity") ??
      defaultIdentity
    const cookie = cookies.get(identity)
    if (!cookie)
      return new Response(`Unknown prototype identity: ${identity}`, {
        status: 400
      })
    if (url.pathname === "/__prototype/identity")
      return Response.json({ backendPort, identity })
    if (url.pathname.startsWith("/api/")) {
      if (
        Bun.env.PROTOTYPE_LIFECYCLE_HARNESS === "true" &&
        Bun.env.PROTOTYPE_SIMULATE_SIGN_OUT === "true" &&
        request.method === "POST" &&
        url.pathname === "/api/auth/sign-out"
      ) {
        simulatedSignOuts.add(identity)
        return Response.json({ success: true })
      }
      if (simulatedSignOuts.has(identity))
        return Response.json({ _tag: "Unauthorized" }, { status: 401 })
      const fixtureWrite =
        Bun.env.PROTOTYPE_ALLOW_TICKET_WRITES === "true" &&
        backendPort === 3110 &&
        /^(?:PATCH|DELETE|POST)$/.test(request.method) &&
        /^\/api\/orgs\/measure\/projects\/ten-thousand\/tickets\/(?:quick|T-\d+)$/.test(
          url.pathname
        )
      const authWrite =
        Bun.env.PROTOTYPE_ALLOW_AUTH_WRITES === "true" &&
        backendPort === 3110 &&
        request.method === "POST" &&
        url.pathname === "/api/auth/sign-out"
      if (request.method !== "GET" && !fixtureWrite && !authWrite)
        return new Response("Read-only fixture preview", { status: 405 })
      const headers = new Headers(request.headers)
      headers.set("cookie", cookie)
      headers.delete("x-projectproject-prototype-identity")
      headers.delete("host")
      if (authWrite) headers.set("origin", backendOrigin)
      const backendResponse = await fetch(
        `http://127.0.0.1:${backendPort}${url.pathname}${url.search}`,
        {
          headers,
          method: request.method,
          ...(request.method !== "GET"
            ? { body: await request.arrayBuffer() }
            : {})
        }
      )
      const responseHeaders = new Headers(backendResponse.headers)
      responseHeaders.delete("set-cookie")
      return new Response(backendResponse.body, {
        status: backendResponse.status,
        statusText: backendResponse.statusText,
        headers: responseHeaders
      })
    }
    const path = resolve(root, "." + decodeURIComponent(url.pathname))
    if (path !== root && !path.startsWith(root + sep))
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
  `Fixture comparison: http://localhost:${port}/orgs/measure/projects/ten-thousand`
)
