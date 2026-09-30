'use client'

// Client-side device fingerprint "beacon" for session device-binding. Computes a stable-ish
// hash from canvas + WebGL + a few environment traits and writes it to the non-httpOnly
// `fp_hash` cookie so it rides along on every request (incl. top-level navigations, where the
// admin/business middleware gates run). The server treats fp_hash as a SOFT / advisory signal
// only — a forged or drifted value can NEVER trigger a session revoke on its own (see
// evaluateBinding in src/lib/auth-sessions.ts), which is exactly why a non-httpOnly cookie is
// acceptable here. Best-effort: any failure is swallowed (fingerprint just stays absent → the
// signal is dropped, fail-open).

const COOKIE = 'fp_hash'
const MAX_AGE_S = 7 * 24 * 60 * 60 // matches the customer/business session TTL

function readCookie(name: string): string | null {
  const m = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)'))
  return m ? decodeURIComponent(m[1]) : null
}

// Mirror the server's cookie attributes (secure in prod, SameSite=Strict, apex domain in prod).
function writeCookie(name: string, value: string): void {
  const secure = location.protocol === 'https:'
  const isProdHost = location.hostname.endsWith('jeffistores.in')
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    'path=/',
    `max-age=${MAX_AGE_S}`,
    'samesite=strict',
  ]
  if (secure) parts.push('secure')
  if (isProdHost) parts.push('domain=.jeffistores.in')
  document.cookie = parts.join('; ')
}

// Collect low-cost, reasonably stable traits. Canvas/WebGL text rendering varies by GPU/driver/
// OS but is stable across a given device+browser for long stretches — good SOFT entropy.
function collectRaw(): string {
  const parts: string[] = []
  try {
    parts.push(navigator.userAgent || '')
    parts.push(navigator.language || '')
    parts.push(String(navigator.hardwareConcurrency || ''))
    parts.push(String((navigator as any).deviceMemory || ''))
    parts.push(String(new Date().getTimezoneOffset()))
    parts.push(`${screen.width}x${screen.height}x${screen.colorDepth}`)
  } catch {}

  try {
    const canvas = document.createElement('canvas')
    canvas.width = 240
    canvas.height = 60
    const ctx = canvas.getContext('2d')
    if (ctx) {
      ctx.textBaseline = 'top'
      ctx.font = "14px 'Arial'"
      ctx.fillStyle = '#f60'
      ctx.fillRect(10, 10, 100, 30)
      ctx.fillStyle = '#069'
      ctx.fillText('jeffi-fp-\u{1F510}', 12, 14)
      parts.push(canvas.toDataURL())
    }
  } catch {}

  try {
    const gl = document.createElement('canvas').getContext('webgl') as WebGLRenderingContext | null
    if (gl) {
      const dbg = gl.getExtension('WEBGL_debug_renderer_info')
      if (dbg) {
        parts.push(String(gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL)))
        parts.push(String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)))
      }
    }
  } catch {}

  return parts.join('||')
}

async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input)
  const digest = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

// Compute the fingerprint and set the cookie if it isn't present yet. Idempotent and cheap:
// once the cookie exists we do nothing. Safe to call on every mount. Never throws.
export async function ensureFingerprintCookie(): Promise<void> {
  try {
    if (typeof document === 'undefined' || !crypto?.subtle) return
    if (readCookie(COOKIE)) return
    const hash = await sha256Hex(collectRaw())
    if (hash) writeCookie(COOKIE, hash)
  } catch {
    // Best-effort only — a missing fp_hash just means the SOFT signal is dropped (fail-open).
  }
}
