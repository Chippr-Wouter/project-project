import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"

export type LogoutStrategies<
  Token,
  CaptureError,
  ServerError,
  CacheError,
  ResetError,
  R = never
> = {
  readonly captureCacheToken: () => Effect.Effect<Token, CaptureError, R>
  readonly serverSignOut: () => Effect.Effect<void, ServerError, R>
  readonly clearCache: (token: Token) => Effect.Effect<void, CacheError, R>
  readonly resetLocalAuth: () => Effect.Effect<void, ResetError, R>
}

export const runLogout = Effect.fn("runLogout")(function* <
  Token,
  CaptureError,
  ServerError,
  CacheError,
  ResetError,
  R
>(
  strategies: LogoutStrategies<
    Token,
    CaptureError,
    ServerError,
    CacheError,
    ResetError,
    R
  >
): Effect.fn.Return<
  void,
  CaptureError | ServerError | CacheError | ResetError,
  R
> {
  const captured = yield* Effect.exit(strategies.captureCacheToken())

  return yield* Effect.uninterruptibleMask((restore) => {
    const afterServerSignOut: Effect.Effect<
      void,
      CaptureError | CacheError,
      R
    > = Exit.isSuccess(captured)
      ? restore(Effect.suspend(() => strategies.clearCache(captured.value)))
      : restore(Effect.failCause(captured.cause).pipe(Effect.asVoid))

    return restore(strategies.serverSignOut()).pipe(
      Effect.andThen(
        Effect.onExit(afterServerSignOut, () => strategies.resetLocalAuth())
      )
    )
  })
})
