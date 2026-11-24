import type { NextRequest } from 'next/server'
import { signServiceToken, verifyServiceToken, type ServiceClaims } from '@jeffi/service-auth'
import { PLATFORM_TENANT_ID } from '@/lib/import/jobs'

// The controller ⇄ voice-service link (plan §8), both ways on the repo's service token (SERVICE_AUTH_SECRET).
// Controller → voice: POST /calls, POST /calls/{id}/hangup at VOICE_SERVICE_URL.
// Voice → controller: the internal outreach call routes accept a token whose `service` is "voice".

export const voiceServiceUrl = (): string | null => {
  const u = process.env.VOICE_SERVICE_URL?.trim()
  return u ? u.replace(/\/+$/, '') : null
}

export class VoiceServiceError extends Error {
  constructor(
    message: string,
    /** HTTP status from voice-service; 0 when it never answered (the call may still have been placed) */
    public status: number,
    public detail: Record<string, unknown> = {}
  ) {
    super(message)
    this.name = 'VoiceServiceError'
  }
  /** voice-service answered and refused: nothing was dialled. */
  get refused() {
    return this.status >= 400
  }
}

const token = () => signServiceToken({ service: 'controller', tenantId: PLATFORM_TENANT_ID, internal: true })

async function post(path: string, body: unknown, timeoutMs: number): Promise<{ status: number; json: Record<string, unknown> }> {
  const base = voiceServiceUrl()
  if (!base) throw new VoiceServiceError('VOICE_SERVICE_URL is not set', 503, { missing: ['VOICE_SERVICE_URL'] })
  let res: Response
  try {
    res = await fetch(`${base}${path}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token()}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
      cache: 'no-store',
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch (e) {
    throw new VoiceServiceError(`voice-service unreachable: ${(e as Error)?.name || 'error'}`, 0)
  }
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>
  return { status: res.status, json: json && typeof json === 'object' ? json : {} }
}

export interface PlaceCallInput {
  callId: string
  to: string
  from: string
  language: string
}

/** Asks voice-service to dial. Idempotent per callId on its side. */
export async function placeCall(input: PlaceCallInput): Promise<{ providerCallId: string; duplicate: boolean }> {
  const { status, json } = await post('/calls', input, 25_000)
  if (status !== 200 || typeof json.providerCallId !== 'string') {
    const { error, ...detail } = json
    throw new VoiceServiceError(typeof error === 'string' ? error : `voice-service answered ${status}`, status || 502, detail)
  }
  return { providerCallId: json.providerCallId, duplicate: json.duplicate === true }
}

export async function hangupCall(callId: string): Promise<boolean> {
  const { status, json } = await post(`/calls/${encodeURIComponent(callId)}/hangup`, {}, 10_000)
  return status === 200 && json.ok === true
}

const VOICE_SERVICES = new Set(['voice', 'voice-service'])

/** The voice-service caller of an internal call route, or null. A token bound to another call is refused. */
export function verifyVoiceRequest(req: NextRequest, callId: string): (ServiceClaims & { callId?: string }) | null {
  const h = req.headers.get('authorization') || ''
  const raw = /^bearer /i.test(h) ? h.slice(7).trim() : undefined
  let claims: (ServiceClaims & { callId?: string }) | null
  try {
    claims = verifyServiceToken(raw)
  } catch {
    return null
  }
  if (!claims || !VOICE_SERVICES.has(claims.service)) return null
  if (claims.callId !== undefined && claims.callId !== callId) return null
  return claims
}

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
