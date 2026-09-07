import path from "node:path"
import { fileURLToPath } from "node:url"
import { defineConfig } from "vite-plus"
import react from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"
import { tanstackRouter } from "@tanstack/router-plugin/vite"
import { paraglideVitePlugin } from "@inlang/paraglide-js"

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig(({ mode }) => ({
  root: __dirname,
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src")
    }
  },
  publicDir: path.resolve(__dirname, "src/public"),
  plugins: [
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
