import * as Context from "effect/Context"
import * as Data from "effect/Data"
import type * as Effect from "effect/Effect"

export class SecretCryptoUnavailable extends Data.TaggedError(
  "SecretCryptoUnavailable"
)<{ readonly reason: string }> {}

export interface SealedSecret {
  readonly ciphertext: string
  readonly nonce: string
  readonly tag: string
}

export interface SecretCryptoShape {
  readonly seal: (
    plaintext: string
  ) => Effect.Effect<SealedSecret, SecretCryptoUnavailable>
  readonly open: (
    sealed: SealedSecret
  ) => Effect.Effect<string, SecretCryptoUnavailable>
}

export class SecretCrypto extends Context.Service<
  SecretCrypto,
  SecretCryptoShape
>()("@projectproject/backend/Services/SecretCrypto") {}
