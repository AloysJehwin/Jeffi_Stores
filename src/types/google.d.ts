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

interface GoogleIdentityServices {
  accounts: {
    id: GoogleAccountsId
  }
}
