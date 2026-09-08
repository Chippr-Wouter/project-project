import * as ConfigProvider from "effect/ConfigProvider"
import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import { afterEach, describe, expect, it, vi } from "vite-plus/test"
import { appAuth, fetchWithTimeout } from "./appAuth"
import { GITHUB_REQUEST_TIMEOUT } from "./request"

const config = ConfigProvider.fromUnknown({
  GITHUB_APP_ID: "123",
  GITHUB_APP_PRIVATE_KEY:
    "-----BEGIN RSA PRIVATE KEY-----\\nfake\\n-----END RSA PRIVATE KEY-----",
  GITHUB_APP_CLIENT_ID: "client-id",
  GITHUB_APP_CLIENT_SECRET: "client-secret"
})

describe("appAuth", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it("aborts OAuth token exchange at the shared GitHub request deadline", async () => {
    const timeout = new AbortController()
    const timeoutSpy = vi
      .spyOn(AbortSignal, "timeout")
      .mockReturnValue(timeout.signal)
    let signal: AbortSignal | undefined
    const fetchMock = vi.fn(
      (
        _input: string | URL | Request,
        init?: RequestInit
      ): Promise<Response> => {
        signal = init?.signal ?? undefined
        return new Promise<Response>((_resolve, reject) => {
          signal?.addEventListener(
            "abort",
            () =>
              reject(
                new DOMException("The operation was aborted", "AbortError")
              ),
            { once: true }
          )
        })
      }
    )
    vi.stubGlobal("fetch", fetchMock)

    const auth = await Effect.runPromise(
      appAuth().pipe(
        Effect.provideService(ConfigProvider.ConfigProvider, config)
      )
    )
    const exchange = auth({ type: "oauth-user", code: "code" })

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    timeout.abort()

    await expect(exchange).rejects.toMatchObject({
      name: "AbortError",
      status: 500
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(signal?.aborted).toBe(true)
    expect(timeoutSpy).toHaveBeenCalledWith(
      Duration.toMillis(GITHUB_REQUEST_TIMEOUT)
    )
  })

  it("merges a caller signal with the shared deadline", async () => {
    const timeout = new AbortController()
    vi.spyOn(AbortSignal, "timeout").mockReturnValue(timeout.signal)
    const caller = new AbortController()
    let signal: AbortSignal | undefined
    const fetchMock = vi.fn(
      (
        _input: string | URL | Request,
        init?: RequestInit
      ): Promise<Response> => {
        signal = init?.signal ?? undefined
        return Promise.resolve(new Response())
      }
    )
    vi.stubGlobal("fetch", fetchMock)

    await fetchWithTimeout("https://github.test", { signal: caller.signal })
    caller.abort()

    expect(signal?.aborted).toBe(true)
    expect(signal).not.toBe(caller.signal)
  })
})
