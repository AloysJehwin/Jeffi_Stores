import { headers } from 'next/headers'

/** Returns the public-facing hostname, preferring x-forwarded-host over host. */
export async function getHost(): Promise<string> {
  const hdrs = await headers()
  return hdrs.get('x-forwarded-host') ?? hdrs.get('host') ?? ''
}
