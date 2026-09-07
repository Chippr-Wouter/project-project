import { defineConfig } from "vite-plus"

export default defineConfig({
  test: {
    maxWorkers: 4,
    projects: ["packages/*/vite.config.ts"]
  },
  lint: {
    categories: {
      correctness: "error",
      suspicious: "warn",
      perf: "warn"
    },
    jsPlugins: [
      {
        name: "workspace",
        specifier: "./tools/oxlint-plugin-workspace.js"
      }
    ],
    options: {
      typeAware: true,
      typeCheck: false
    },
    plugins: ["eslint", "oxc", "react", "unicorn", "typescript"],
    rules: {
      "react-in-jsx-scope": "off",
      "react/refs": "warn",
      "react/set-state-in-effect": "warn",
      "react/immutability": "warn",
      "react/static-components": "warn",
      "eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          ignoreRestSiblings: true
        }
      ],
      "eslint/no-shadow": "off",
      "eslint/no-await-in-loop": "off",
      "eslint/no-underscore-dangle": "off",
      "workspace/no-relative-packages": "error"
    },
    ignorePatterns: [
      "node_modules",
      "bun.lock",
      "*.tsbuildinfo",
      "**/routeTree.gen.ts",
      "**/*.md"
    ]
  },
  fmt: {
    printWidth: 80,
    tabWidth: 2,
    useTabs: false,
    endOfLine: "lf",
    semi: false,
    singleQuote: false,
    trailingComma: "none",
    arrowParens: "always",
    objectWrap: "preserve",
    sortImports: false,
    sortPackageJson: false,
    ignorePatterns: [
      "**/node_modules",
      "**/dist",
      "**/build",
      "**/.next",
      "**/db/migrations/meta/**",
      "docs/everhour-api-schema.yml",
      "bun.lock",
      "**/routeTree.gen.ts",
      "package-lock.json",
      "pnpm-lock.yaml",
      "yarn.lock",
      "**/*.md"
    ]
  }
})
