import path from "node:path"
import { fileURLToPath } from "node:url"
import { defineConfig } from "vite-plus"
import react from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"
import { tanstackRouter } from "@tanstack/router-plugin/vite"
import { paraglideVitePlugin } from "@inlang/paraglide-js"

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// Why this config (not TanStack Start)?
// ---------------------------------------------------------------------------
// PROJECTPROJECT.md calls for "TanStack Start (SPA mode)". TanStack Start's
// value-add over plain @tanstack/react-router is server-side rendering and
// server functions — neither of which we use, since ProjectProject has a dedicated
// Effect backend handling all server logic. We use @tanstack/react-router
// + Vite + React directly. Every API used in the spec's frontend examples
// (createFileRoute, redirect, Outlet, Link) lives in @tanstack/react-router
// itself, so the lessons translate identically. If a future chapter needs
// Start specifically, we can add it then.

export default defineConfig(({ mode }) => ({
  // `@/...` resolves to `src/...`. Mirrors the `paths` entry in tsconfig.json
  // so types and runtime agree. Reach for relative imports only when staying
  // inside a tightly co-located module (e.g. a component pulling its sibling
  // styles); reach for `@/` when crossing top-level concerns (atoms, services,
  // routes).
  root: __dirname,
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src")
    }
  },
  // Static assets live alongside the rest of the app under src/public/. Vite
  // copies their contents to the build root, so `src/public/icon/favicon.ico`
  // is served at `/icon/favicon.ico` in dev and prod.
  publicDir: path.resolve(__dirname, "src/public"),
  plugins: [
    // Generates packages/frontend/src/routeTree.gen.ts from files in src/routes/
    ...(mode === "test"
      ? []
      : [tanstackRouter({ target: "react", autoCodeSplitting: true })]),
    react(),
    ...(mode === "test" ? [] : [tailwindcss()]),
    paraglideVitePlugin({
      project: path.resolve(__dirname, "project.inlang"),
      outdir: path.resolve(__dirname, "src/paraglide"),
      strategy: ["cookie", "preferredLanguage", "baseLocale"],
      cookieName: "pp_locale",
      cookieMaxAge: 60 * 60 * 24 * 365,
      emitTsDeclarations: true
    })
  ],
  test: {
    name: "frontend",
    include: ["src/**/*.test.{ts,tsx}"],
    environment: "jsdom",
    pool: "forks",
    execArgv: ["--no-experimental-webstorage"],
    environmentOptions: { jsdom: { url: "http://localhost/" } }
  },
  server: {
    port: 5173,
    // The frontend dev server proxies API calls to the backend so that the
    // browser sees a single origin. This sidesteps every cross-origin cookie
    // headache (SameSite, credentials, preflight) — Better Auth's session
    // cookie set on a `:3000` response comes back to the browser looking
    // exactly like a same-origin cookie, because the response was served
    // through `:5173`.
    //
    // Backend owns the `/api` namespace natively — it serves `/api/me`,
    // `/api/health`, `/api/auth/*`. So this proxy is a pure forwarder, no
    // path rewriting. `HttpApiClient` on the frontend uses baseUrl `/api`,
    // browser hits `:5173/api/me`, Vite forwards to `:3000/api/me`, and the
    // backend's HttpRouter dispatches the same path it would for a direct curl.
    proxy: {
      "/api": {
        target: "http://localhost:3000",
        changeOrigin: true
      },
      // OAuth 2.1 discovery (RFC 8414, RFC 9728) mandates that clients fetch
      // AS and protected-resource metadata at `<issuer>/.well-known/...` —
      // at the issuer origin's root, not under any handler path. Better
      // Auth mounts these endpoints only under `/api/auth/.well-known/...`,
      // so we forward the root paths to the backend's actual endpoints.
      //
      // The issuer is `BETTER_AUTH_URL=http://localhost:5173` (the frontend
      // origin) — this is deliberate: OIDC redirects (login page, consent
      // page) need to land on routes the frontend serves. If we moved the
      // issuer to `:3000`, those redirects would land on the backend with
      // no UI to render them.
      //
      // PRODUCTION: mirror these two rules in your reverse proxy (nginx,
      // Caddy, Cloudflare, ...) so MCP clients can discover the AS in prod
      // too. This vite config only matters in dev.
      "/.well-known/oauth-authorization-server": {
        target: "http://localhost:3000",
        changeOrigin: true,
        rewrite: () => "/api/auth/.well-known/oauth-authorization-server"
      },
      "/.well-known/oauth-protected-resource": {
        target: "http://localhost:3000",
        changeOrigin: true,
        rewrite: () => "/api/auth/.well-known/oauth-protected-resource"
      }
    }
  }
}))
