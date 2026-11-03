import { CALLBACK_HTML } from '@/lib/auth/google-callback-html'

// Google's registered redirect URI; see google-callback-html.ts for why it's plain HTML.
export function GET() {
  return new Response(CALLBACK_HTML, {
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' },
  })
}
