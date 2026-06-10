interface GoogleOAuthPopupOptions {
  clientId: string
  scope?: string
  width?: number
  height?: number
}

export interface GoogleOAuthResult {
  accessToken: string | null
  error: string | null
}

export function openGoogleOAuthPopup({
  clientId,
  scope = 'openid email profile',
  width = 500,
  height = 600,
}: GoogleOAuthPopupOptions): Promise<GoogleOAuthResult> {
  return new Promise((resolve) => {
    if (typeof window === 'undefined') {
      resolve({ accessToken: null, error: 'window unavailable' })
      return
    }

    // Always use the main domain for the OAuth redirect — business subdomain is not a registered redirect URI
    const mainOrigin = window.location.hostname.startsWith('business.')
      ? window.location.origin.replace(/^(https?:\/\/)business\./, '$1')
      : window.location.origin
    const redirectUri = `${mainOrigin}/auth/google/callback`
    const state = Math.random().toString(36).slice(2)
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'token',
      scope,
      include_granted_scopes: 'true',
      state,
      prompt: 'select_account',
    })
    const url = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`

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
      try { popup.close() } catch {}
      resolve(result)
    }

    // Safety net: resolve after 3 min so googleLoading never stays true forever
    const timeoutId = window.setTimeout(() => {
      finish({ accessToken: null, error: 'Sign-in timed out. Please try again.' })
    }, 3 * 60 * 1000)

    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return
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
