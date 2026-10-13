// Web-standard stand-ins for next/server so lifted handlers (and their tests) stay unchanged.
import type { ServiceClaims } from '@jeffi/service-auth'

export class NextResponse extends Response {
  static json(body: any, init: ResponseInit = {}) {
    return new NextResponse(JSON.stringify(body), { ...init, headers: { 'content-type': 'application/json', ...(init.headers as any) } })
  }
  static redirect(url: string | URL, status = 307) {
    return new NextResponse(null, { status, headers: { location: String(url) } })
  }
}

export class NextRequest extends Request {
  claims?: ServiceClaims
  get nextUrl(): URL {
    return new URL(this.url)
  }
}

