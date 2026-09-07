import { defineConfig } from "vite-plus"

export default defineConfig({
  root: import.meta.dirname,
  test: {
    name: "shared",
    include: ["src/**/*.test.ts"],
    environment: "node"
  }
})
