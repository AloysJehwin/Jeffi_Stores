interface GoogleOAuthPopupOptions {
  clientId: string
  scope?: string
  width?: number
  height?: number
  /** Path to redirect back to when the popup is blocked and Google falls back
   *  to a full-page redirect (e.g. '/admin/login'). Defaults to the current path. */
  returnTo?: string
}

export interface GoogleOAuthResult {
  accessToken: string | null
  error: string | null
}

/** jeffistores.in, its subdomains and localhost — the only hosts the callback will send a tab back to. */
export function isOwnHost(host: string): boolean {
  return /(^|\.)jeffistores\.in$/i.test(host) || /(^|\.)localhost$/i.test(host) || host === '127.0.0.1'
}

/**
 * On a page that started Google sign-in: the returned token (or error) from the URL hash, removed from the
 * address bar. null when this page load isn't a Google return.
 */
export function consumeGoogleRedirect(): GoogleOAuthResult | null {
  if (typeof window === 'undefined') return null
  const params = new URLSearchParams(window.location.hash.slice(1))
  const accessToken = params.get('access_token')
  const error = params.get('error')
  if (!accessToken && !error) return null
  window.history.replaceState(null, '', window.location.pathname + window.location.search)
  return { accessToken, error: accessToken ? null : error }
}

/**
 * The origin Google returns to. Only jeffistores.in and localhost are registered redirect URIs, so any
 * subdomain (admin., business., ecom., {slug}., admin-{slug}.) collapses to the root; the callback page
 * then sends the tab back to the exact host it started on.
 */
export function googleRedirectOrigin(origin: string): string {
  return origin
    .replace(/^(https?:\/\/)([a-z0-9-]+\.)+(jeffistores\.in)/i, '$1$3')
    .replace(/^(https?:\/\/)([a-z0-9-]+\.)+(localhost)\b/i, '$1$3')
}

export function openGoogleOAuthPopup({
  clientId,
  scope = 'openid email profile',
  width = 500,
  height = 600,
  returnTo,
}: GoogleOAuthPopupOptions): Promise<GoogleOAuthResult> {
  return new Promise(resolve => {
    if (typeof window === 'undefined') {
      resolve({ accessToken: null, error: 'window unavailable' })
      return
    }

    // Always use the ROOT domain for the OAuth redirect. Only jeffistores.in
    // (+ localhost) is a registered redirect URI in Google Console — app subdomains
    // (business./ecom./admin.) AND tenant storefronts ({slug}.jeffistores.in) are not.
    // Collapse any subdomain of jeffistores.in down to the bare root so the callback
    // always lands on the registered URI, then postMessage's the token back up.
    const mainOrigin = googleRedirectOrigin(window.location.origin)
    const redirectUri = `${mainOrigin}/auth/google/callback`

    // State carries the FULL return URL (origin included) so the callback, which always runs on the root
    // domain, sends the tab back to the exact page it came from (admin./business./ecom./tenant hosts).
    const nonce = Math.random().toString(36).slice(2)
    // Same-tab on our own hosts; a popup elsewhere ("p." tells the callback to post back to the opener).
    const sameTab = isOwnHost(window.location.hostname)
    const path = returnTo || window.location.pathname
    // Keep the query (e.g. ?redirect=) — every caller is the sign-in page itself.
    const destination = `${window.location.origin}${path}${window.location.search}`
    const state = `${sameTab ? '' : 'p.'}${nonce}|${encodeURIComponent(destination)}`

    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'token',
      scope,
      state,
      prompt: 'select_account',
    })
    const url = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`

    // Same-tab flow on our own hosts: popups/new tabs could get stuck and need a manual reload. The page
    // unloads, so this promise never settles; the page completes sign-in on return (consumeGoogleRedirect).
    // Custom tenant domains keep the popup: the callback can only safely send a tab back to our hosts.
    if (sameTab) {
      // Back from Google restores this page from the back/forward cache with the button still loading:
      // settle as a quiet cancel so the caller resets it.
      const onShow = (e: PageTransitionEvent) => {
        if (!e.persisted) return
        window.removeEventListener('pageshow', onShow)
        resolve({ accessToken: null, error: 'popup_closed' })
      }
      window.addEventListener('pageshow', onShow)
      window.location.assign(url)
      return
    }

    const dualScreenLeft = window.screenLeft ?? window.screenX ?? 0
    const dualScreenTop = window.screenTop ?? window.screenY ?? 0
    const winWidth = window.innerWidth || document.documentElement.clientWidth || screen.width
    const winHeight = window.innerHeight || document.documentElement.clientHeight || screen.height
    const left = dualScreenLeft + (winWidth - width) / 2
    const top = dualScreenTop + (winHeight - height) / 2

    const features = `width=${width},height=${height},left=${left},top=${top},popup=yes,scrollbars=yes,resizable=yes,status=no,location=no,toolbar=no,menubar=no`

    const popup = window.open(url, 'jeffi-google-oauth', features)

    if (!popup) {
      resolve({ accessToken: null, error: 'Popup was blocked. Please allow popups and try again.' })
      return
    }

    let settled = false
    const finish = (result: GoogleOAuthResult) => {
      if (settled) return
      settled = true
      window.removeEventListener('message', onMessage)
      window.clearInterval(closedInterval)
      window.clearTimeout(timeoutId)
      try {
        popup.close()
      } catch {}
      resolve(result)
    }

    // Safety net: resolve after 3 min so googleLoading never stays true forever
    const timeoutId = window.setTimeout(
      () => {
        finish({ accessToken: null, error: 'Sign-in timed out. Please try again.' })
      },
      3 * 60 * 1000
    )

    const onMessage = (event: MessageEvent) => {
      // Accept postMessage from the main origin (callback page) even when on an app subdomain
      const expectedOrigin = googleRedirectOrigin(window.location.origin)
      if (event.origin !== expectedOrigin && event.origin !== window.location.origin) return
      const data = event.data
      if (!data || data.source !== 'jeffi-google-oauth') return
      if (data.error) {
        finish({ accessToken: null, error: data.error })
        return
      }
      if (data.accessToken) {
        finish({ accessToken: data.accessToken, error: null })
      }
    }

    const closedInterval = window.setInterval(() => {
      if (popup.closed) {
        setTimeout(() => {
          finish({ accessToken: null, error: 'popup_closed' })
        }, 300)
        window.clearInterval(closedInterval)
      }
    }, 500)

    window.addEventListener('message', onMessage)
  })
}
