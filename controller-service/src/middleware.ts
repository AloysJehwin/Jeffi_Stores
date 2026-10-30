import type { NextRequest } from 'next/server'
import { middleware as shared } from '@/middleware'

// The middleware lives in packages/store-core (shared by every app). Next reads config from this file,
// and Turbopack only applies its runtime to a middleware function declared here, not a re-export.
export function middleware(request: NextRequest) {
  return shared(request)
}

// Node runtime: the auth cookie is now an opaque session id, so middleware must resolve
// it against Postgres (via verifyToken/verifyBusinessToken → resolveSession). Node
// middleware is stable in Next 15.5. pg is kept external via serverExternalPackages.
// Session lookups only run when an auth cookie is present, so anonymous storefront
// traffic does zero auth DB queries.
export const config = {
  runtime: 'nodejs',
  // auth/google/callback is static HTML: skipping middleware keeps it instant (in dev it otherwise waits on
  // every middleware recompile, leaving a blank tab on the callback URL).
  matcher: ['/((?!_next/static|_next/image|favicon.ico|images|screenshots|icon.png|apple-icon.png|auth/google/callback).*)'],
}
