import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { verifyToken } from './lib/jwt'
import { getScopeForPath, hasScope } from './lib/scopes'

export async function middleware(request: NextRequest) {
  const hostname = request.headers.get('host') || ''
  const pathname = request.nextUrl.pathname

  if (hostname.startsWith('forms.')) {
    const slug = pathname === '/' ? '' : pathname
    return NextResponse.rewrite(new URL(`/forms${slug}`, request.url))
  }

  if (pathname.startsWith('/forms/')) {
    const slug = pathname.replace('/forms/', '')
    return NextResponse.redirect(new URL(`https://forms.jeffistores.in/${slug}`, request.url), 301)
  }

  const isAdminSubdomain = hostname.startsWith('admin.')
  const isAdminPath = pathname.startsWith('/admin')
  const isAdminApiPath = pathname.startsWith('/api/admin')

  const publicApiPaths = ['/api/admin/login', '/api/admin/check-session']
  if (isAdminApiPath && publicApiPaths.some(path => pathname.startsWith(path))) {
    return NextResponse.next()
  }

  if (isAdminSubdomain && !isAdminPath && !isAdminApiPath) {
    if (pathname.startsWith('/api/')) {
      return NextResponse.next()
    }
    return NextResponse.redirect(new URL('/admin/dashboard', request.url))
  }

  if (isAdminApiPath) {
    const token = request.cookies.get('admin_token')?.value
    if (!token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const payload = await verifyToken(token)
    if (!payload) {
      return NextResponse.json({ error: 'Invalid token' }, { status: 401 })
    }

    const certCN = request.headers.get('x-client-cert-cn') || ''
    const tokenCertCN = payload.authCertCN || payload.username
    if (certCN && !certCN.includes(' ') && tokenCertCN !== certCN) {
      return NextResponse.json(
        { error: 'Certificate does not match authenticated user' },
        { status: 403 }
      )
    }

    const requiredScope = getScopeForPath(pathname)
    if (requiredScope && !hasScope(payload.role, payload.scopes || [], requiredScope)) {
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
    }

    return NextResponse.next()
  }

  if (isAdminPath) {
    const isLocalhost = hostname === 'localhost' || hostname.startsWith('localhost:') ||
                       hostname === '127.0.0.1' || hostname.startsWith('127.0.0.1:') ||
                       hostname.startsWith('app:') ||
                       hostname.startsWith('192.168.') || hostname.startsWith('10.') ||
                       hostname.endsWith('.ngrok-free.app') || hostname.endsWith('.ngrok-free.dev')

    if (pathname === '/admin/login') {
      const response = NextResponse.next()
      response.headers.set('x-pathname', pathname)
      return response
    }

    if (!isAdminSubdomain && !isLocalhost) {
      return new NextResponse('Admin access requires the admin subdomain', {
        status: 403,
        headers: { 'Content-Type': 'text/plain' },
      })
    }

    const token = request.cookies.get('admin_token')?.value

    if (!token) {
      return NextResponse.redirect(new URL('/admin/login', request.url))
    }

    const payload = await verifyToken(token)

    if (!payload) {
      const response = NextResponse.redirect(new URL('/admin/login', request.url))
      response.cookies.delete('admin_token')
      return response
    }

    const certCN = request.headers.get('x-client-cert-cn') || ''
    const tokenCertCN = payload.authCertCN || payload.username
    if (certCN && !certCN.includes(' ') && tokenCertCN !== certCN) {
      const response = NextResponse.redirect(new URL('/admin/login', request.url))
      response.cookies.delete('admin_token')
      return response
    }

    const requiredScope = getScopeForPath(pathname)
    if (requiredScope && !hasScope(payload.role, payload.scopes || [], requiredScope)) {
      return new NextResponse('Insufficient permissions', {
        status: 403,
        headers: { 'Content-Type': 'text/plain' },
      })
    }

    const response = NextResponse.next()
    response.headers.set('x-pathname', pathname)
    response.headers.set('x-user-id', payload.adminId)
    response.headers.set('x-username', payload.username)
    response.headers.set('x-user-role', payload.role)
    response.headers.set('x-user-scopes', JSON.stringify(payload.scopes || []))
    return response
  }

  return NextResponse.next()
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|images|icon.png|apple-icon.png).*)',
  ],
}
