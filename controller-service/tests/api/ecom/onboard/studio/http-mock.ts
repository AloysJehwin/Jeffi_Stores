import { NextResponse, type NextRequest } from 'next/server'

// A stand-in for @controller/lib/site-studio/http (it imports server-only, absent from some installs): the same
// owner / studio / failure contract, with the session read from the test's own mocks.
interface Mocks {
  owner: (...a: unknown[]) => unknown
  session?: (...a: unknown[]) => unknown
  aiUp?: (...a: unknown[]) => unknown
}

export function httpMock(m: Mocks) {
  const fail = (error: string, status = 400, extra?: Record<string, unknown>) => NextResponse.json({ error, ...extra }, { status })
  const studioOwner = async (_request: NextRequest) => (await m.owner()) ?? NextResponse.json({ error: 'Not signed in' }, { status: 401 })
  const studioProductOf = (r: NextRequest) => (r.nextUrl.searchParams.get('product') === 'showcase' ? 'showcase' : 'store')
  const studioSiteOf = (r: NextRequest) => {
    const site = r.nextUrl.searchParams.get('site')
    return site && /^[0-9a-f-]{36}$/i.test(site) ? site : null
  }
  const studioOf = async (r: NextRequest) => {
    const owner = await studioOwner(r)
    if (owner instanceof NextResponse) return owner
    const session = await m.session!(owner, studioProductOf(r), studioSiteOf(r))
    return session ? { owner, session } : fail('Start the studio first', 404)
  }
  const aiUnavailable = async () => ((await m.aiUp?.()) === false ? fail('AI is down. You can carry on without it.', 503, { code: 'ai_unavailable' }) : null)
  return {
    fail,
    studioOwner,
    studioProductOf,
    studioSiteOf,
    studioOf,
    aiUnavailable,
    studioAiAvailable: async (opts?: unknown) => m.aiUp?.('platform', opts),
    aiDownFrom: (err: unknown) => ((err as Error)?.name === 'StudioAiDownError' ? fail('AI is down.', 503, { code: 'ai_unavailable' }) : null),
    readJson: async (r: NextRequest) => {
      const raw = await r.json().catch(() => null)
      return raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null
    },
    studioView: (s: { id?: string; pages?: object; catalog?: unknown } | null) => (s ? { session: { id: s.id, hasCatalog: !!s.catalog, ...s } } : { session: null }),
  }
}
