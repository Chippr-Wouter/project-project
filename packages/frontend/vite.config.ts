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
      // Preserve the full discovery path for Better Auth's root well-known routes.
      "/.well-known/": {
        target: "http://localhost:3000",
        changeOrigin: true
      }
    }
  }
}))
