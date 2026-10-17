import { facebookProvider, instagramProvider } from './meta'
import { gbpProvider } from './gbp'
import { youtubeProvider } from './youtube'
import { pinterestProvider } from './pinterest'
import { linkedinProvider } from './linkedin'
import { xProvider } from './x'
import { PLATFORM_NETWORK, type Network, type Platform, type SocialProvider } from './types'

const PROVIDERS: Record<Network, SocialProvider> = {
  facebook: facebookProvider,
  instagram: instagramProvider,
  gbp: gbpProvider,
  youtube: youtubeProvider,
  pinterest: pinterestProvider,
  linkedin: linkedinProvider,
  x: xProvider,
}

export function providerFor(network: Network): SocialProvider {
  return PROVIDERS[network]
}

export function networkOf(platform: string): Network {
  return PLATFORM_NETWORK[platform as Platform] ?? 'facebook'
}

/** Networks whose sign-in is set up on this platform (their env is present). Meta uses its own flow. */
export function oauthNetworks(): { network: Network; label: string; ready: boolean; missing: string[] }[] {
  return (Object.values(PROVIDERS) as SocialProvider[])
    .filter(p => p.oauth)
    .map(p => {
      const missing = p.oauth!.env.filter(k => !process.env[k])
      return { network: p.network, label: p.label, ready: missing.length === 0, missing }
    })
}

export * from './types'
