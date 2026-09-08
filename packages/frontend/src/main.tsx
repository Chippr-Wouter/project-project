import { RegistryContext, useAtomMount } from "@effect/atom-react"
import { StrictMode } from "react"
import ReactDOM from "react-dom/client"
import { createRouter, RouterProvider } from "@tanstack/react-router"
import { STATE_COLORS } from "@projectproject/shared"
import { registry } from "./runtime"
import { ticketSyncLifecyclePrototypeAtom } from "./atoms/ticketSyncAuthPrototype"
import { routeTree } from "./routeTree.gen"
import "./styles.css"

const stateColorStyle = document.createElement("style")
const lightStateVars = Object.entries(STATE_COLORS)
  .map(([name, c]) => `--state-${name}:${c.light.oklch};`)
  .join("")
const darkStateVars = Object.entries(STATE_COLORS)
  .map(([name, c]) => `--state-${name}:${c.dark.oklch};`)
  .join("")
stateColorStyle.textContent = `:root{${lightStateVars}}.dark{${darkStateVars}}`
document.head.appendChild(stateColorStyle)

const router = createRouter({
  routeTree,
  defaultPreload: "intent",
  context: { registry }
})

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router
  }
}

const rootEl = document.getElementById("root")
if (!rootEl) throw new Error("Root element #root not found")

function App() {
  useAtomMount(ticketSyncLifecyclePrototypeAtom)
  return <RouterProvider router={router} />
}

ReactDOM.createRoot(rootEl).render(
  <StrictMode>
    <RegistryContext.Provider value={registry}>
      <App />
    </RegistryContext.Provider>
  </StrictMode>
)
