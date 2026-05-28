interface GoogleAccountsId {
  initialize(config: {
    client_id: string
    callback: (response: { credential: string }) => void
  }): void
  renderButton(
    parent: HTMLElement,
    options: {
      type?: string
      theme?: string
      size?: string
      width?: string | number
      text?: string
    }
  ): void
  prompt(): void
}

interface GoogleTokenClient {
  requestAccessToken(overrideConfig?: { prompt?: string }): void
}

interface GoogleAccountsOauth2 {
  initTokenClient(config: {
    client_id: string
    scope: string
    ux_mode?: 'popup' | 'redirect'
    callback: (response: { access_token?: string; error?: string; error_description?: string }) => void
    error_callback?: (error: { type: string; message?: string }) => void
  }): GoogleTokenClient
}

interface GoogleIdentityServices {
  accounts: {
    id: GoogleAccountsId
    oauth2: GoogleAccountsOauth2
  }
}
