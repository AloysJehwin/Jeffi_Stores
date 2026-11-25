// HTTP-mapped errors shared by the routers (status read by server.ts).

export class ValidationError extends Error { readonly status = 400 }
export class UpstreamError extends Error {
  constructor(message: string, readonly tried: { provider: string; error: string }[]) { super(message) }
  readonly status = 502
}
export class NotConfiguredError extends Error { readonly status = 503 }
