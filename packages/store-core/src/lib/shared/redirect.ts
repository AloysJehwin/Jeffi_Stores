import { NextResponse } from 'next/server'

// Same-host redirect with a relative Location. Behind the proxy request.url / nextUrl carry the
// listener's bind address (0.0.0.0:3000), so absolute redirects built from them leave the site;
// a relative Location keeps the browser on whatever host (flagship or tenant) it asked for.
export function sameHostRedirect(pathWithQuery: string, status: 302 | 303 | 307 = 307): NextResponse {
  if (!pathWithQuery.startsWith('/') || pathWithQuery.startsWith('//')) {
    throw new Error(`sameHostRedirect needs a path, got ${pathWithQuery}`)
  }
  return new NextResponse(null, { status, headers: { Location: pathWithQuery } })
}
