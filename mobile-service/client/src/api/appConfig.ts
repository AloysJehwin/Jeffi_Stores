import { api } from './client'

export interface AppConfig {
  min_app_version: string
  site_url: string
}

/** mobile-service GET /v1/app/config: the oldest app build the backend still serves. */
export function getAppConfig(): Promise<AppConfig> {
  return api<AppConfig>('/v1/app/config', { token: null })
}

/** True when `current` (x.y.z) is older than `min`. Unknown versions never count as old. */
export function isOlderVersion(current: string | null | undefined, min: string | null | undefined): boolean {
  const parse = (v: string | null | undefined) => {
    const m = /^(\d+)\.(\d+)\.(\d+)/.exec(String(v ?? '').trim())
    return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null
  }
  const a = parse(current)
  const b = parse(min)
  if (!a || !b) return false
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] < b[i]
  }
  return false
}
