export type SecretsBackend = 'aws' | 'keyvault'

/** NotFound: no such secret. Deleted: scheduled for deletion / soft-deleted (restore() brings it back). */
export type SecretErrorCode = 'NotFound' | 'Deleted' | 'Exists' | 'Denied' | 'Invalid' | 'Backend'

export declare class SecretError extends Error {
  readonly code: SecretErrorCode
  readonly secret: string
  constructor(code: SecretErrorCode, secret: string, message: string, cause?: unknown)
}

export declare function isSecretError(e: unknown, code?: SecretErrorCode): e is SecretError

type Env = Record<string, string | undefined>

export interface SecretsOptions {
  /** aws | keyvault; defaults to SECRETS_BACKEND. */
  backend?: string
  /** Secrets Manager region; defaults to AWS_REGION. */
  region?: string
  env?: Env
  fetch?: typeof fetch
  /** Key Vault create(): wait before re-reading to settle a concurrent create (default 1000). */
  settleMs?: number
  /** Key Vault restore()/purge poll interval (default 1000). */
  pollMs?: number
}

export interface SecretsClient {
  readonly backend: SecretsBackend
  get(name: string): Promise<string>
  /** Create or overwrite. */
  put(name: string, value: string): Promise<void>
  /** Create only; throws Exists when another value is stored, Deleted when scheduled for deletion. Returns the stored value. */
  create(name: string, value: string): Promise<string>
  /** Missing is success. force: no recovery window. recoveryDays: Secrets Manager only (Key Vault uses the vault's retention). */
  remove(name: string, opts?: { force?: boolean; recoveryDays?: number }): Promise<void>
  restore(name: string): Promise<void>
}

export declare function secretsBackend(env?: Env): SecretsBackend
export declare function keyVaultName(name: string): string
export declare function keyVaultUrl(env?: Env): string
export declare function createSecretsClient(opts?: SecretsOptions): SecretsClient
export declare function secrets(region?: string): SecretsClient
export declare function getSecretJson<T = Record<string, unknown>>(name: string, opts?: SecretsOptions): Promise<T>

export interface DbSecret {
  username?: string
  password: string
  database?: string
  expiresAt: number
}
export declare function fetchDbSecret(ref: string, region?: string): Promise<DbSecret>
export declare function forgetDbSecret(ref: string): void

export interface LoadedSecretEnv {
  /** The id actually read (fallbackId when the primary was missing or denied). */
  id: string
  backend: SecretsBackend
  /** The blob's string values. */
  values: Record<string, string>
}
export declare function loadSecretEnv(id: string, opts?: SecretsOptions & { fallbackId?: string }): Promise<LoadedSecretEnv>
