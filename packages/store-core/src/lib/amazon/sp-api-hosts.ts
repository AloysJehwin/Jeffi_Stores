// SP-API endpoints a store may pick. Only these are accepted, so a stored host can never point the
// access token at anything else.
export const SP_API_HOSTS = [
  { value: 'https://sellingpartnerapi-eu.amazon.com', label: 'Production, Europe and India (EU)' },
  { value: 'https://sellingpartnerapi-na.amazon.com', label: 'Production, North America (NA)' },
  { value: 'https://sellingpartnerapi-fe.amazon.com', label: 'Production, Far East (FE)' },
  { value: 'https://sandbox.sellingpartnerapi-eu.amazon.com', label: 'Sandbox, Europe and India (EU)' },
  { value: 'https://sandbox.sellingpartnerapi-na.amazon.com', label: 'Sandbox, North America (NA)' },
  { value: 'https://sandbox.sellingpartnerapi-fe.amazon.com', label: 'Sandbox, Far East (FE)' },
] as const

export const DEFAULT_SP_API_HOST = 'https://sandbox.sellingpartnerapi-eu.amazon.com'

export function isSpApiHost(host: unknown): host is string {
  return typeof host === 'string' && SP_API_HOSTS.some(h => h.value === host)
}
