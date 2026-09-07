import { describe, expect, it } from "vite-plus/test"
import * as Effect from "effect/Effect"
import { randomBytes } from "node:crypto"
import { SecretCrypto } from "../Services/SecretCrypto"
import { SecretCryptoLive } from "./SecretCrypto"

const withKey =
  <A>(run: () => Promise<A>) =>
  async () => {
    const previous = process.env.USER_SECRET_ENCRYPTION_KEY
    process.env.USER_SECRET_ENCRYPTION_KEY = randomBytes(32).toString("base64")
    try {
      return await run()
    } finally {
      process.env.USER_SECRET_ENCRYPTION_KEY = previous
    }
  }

const run = <A, E>(effect: Effect.Effect<A, E, SecretCrypto>) =>
  Effect.runPromise(
    Effect.provide(effect, SecretCryptoLive) as Effect.Effect<A, E, never>
  )

describe("SecretCrypto", () => {
  it(
    "round-trips a secret",
    withKey(async () => {
      const opened = await run(
        Effect.gen(function* () {
          const crypto = yield* SecretCrypto
          const sealed = yield* crypto.seal("r2-secret-key")
          return yield* crypto.open(sealed)
        })
      )
      expect(opened).toBe("r2-secret-key")
    })
  )

  it(
    "produces a different nonce every time",
    withKey(async () => {
      const [a, b] = await run(
        Effect.gen(function* () {
          const crypto = yield* SecretCrypto
          return [yield* crypto.seal("same"), yield* crypto.seal("same")]
        })
      )
      expect(a.nonce).not.toBe(b.nonce)
      expect(a.ciphertext).not.toBe(b.ciphertext)
    })
  )

  it(
    "fails to open a tampered ciphertext",
    withKey(async () => {
      const result = await run(
        Effect.gen(function* () {
          const crypto = yield* SecretCrypto
          const sealed = yield* crypto.seal("r2-secret-key")
          return yield* Effect.either(
            crypto.open({
              ...sealed,
              ciphertext: Buffer.from("tampered").toString("base64")
            })
          )
        })
      )
      expect(result._tag).toBe("Left")
    })
  )

  it("fails when the key is absent", async () => {
    const previous = process.env.USER_SECRET_ENCRYPTION_KEY
    delete process.env.USER_SECRET_ENCRYPTION_KEY
    try {
      const result = await run(
        Effect.gen(function* () {
          const crypto = yield* SecretCrypto
          return yield* Effect.either(crypto.seal("x"))
        })
      )
      expect(result._tag).toBe("Left")
    } finally {
      process.env.USER_SECRET_ENCRYPTION_KEY = previous
    }
  })

  it("fails when the key is the wrong length", async () => {
    const previous = process.env.USER_SECRET_ENCRYPTION_KEY
    process.env.USER_SECRET_ENCRYPTION_KEY =
      Buffer.from("short").toString("base64")
    try {
      const result = await run(
        Effect.gen(function* () {
          const crypto = yield* SecretCrypto
          return yield* Effect.either(crypto.seal("x"))
        })
      )
      expect(result._tag).toBe("Left")
    } finally {
      process.env.USER_SECRET_ENCRYPTION_KEY = previous
    }
  })
})
