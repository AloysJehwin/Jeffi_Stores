// One interface per social network. Publishing, metrics and the inbox go through it, so the
// publisher, insights and inbox jobs do not know which network they talk to.

export const NETWORKS = ['facebook', 'instagram', 'gbp', 'youtube', 'pinterest', 'linkedin', 'x'] as const
export type Network = (typeof NETWORKS)[number]

/** scheduled_social_posts.platform values and the network each one posts to. */
export const PLATFORM_NETWORK = {
  fb: 'facebook',
  ig: 'instagram',
  ig_reel: 'instagram',
  gbp: 'gbp',
  youtube: 'youtube',
  pinterest: 'pinterest',
  linkedin: 'linkedin',
  x: 'x',
} as const satisfies Record<string, Network>
export type Platform = keyof typeof PLATFORM_NETWORK

/** Credentials and the target (Page, location, channel, board, organisation, user) a post goes to. */
export interface SocialAuth {
  accessToken: string
  refreshToken?: string | null
  /** ISO time the access token expires, when it does. */
  expiresAt?: string | null
  targetId: string
  targetName?: string | null
  extra?: Record<string, string>
}

export interface PublishInput {
  caption: string
  title?: string | null
  link?: string | null
  imageUrls: string[]
  videoUrl?: string | null
}

export interface PublishResult {
  externalId: string
  url?: string | null
}

export interface PostMetrics {
  impressions?: number
  reach?: number
  likes?: number
  comments?: number
  shares?: number
  saves?: number
  clicks?: number
  videoViews?: number
}

export interface InboxItem {
  externalId: string
  /** The network's id of the post it belongs to (null for reviews). */
  postExternalId: string | null
  kind: 'comment' | 'review'
  author: string | null
  text: string | null
  rating?: number | null
  createdAt: string | null
  /** Already answered by the business on the network. */
  replied?: boolean
}

export interface TokenSet {
  accessToken: string
  refreshToken?: string | null
  expiresAt?: string | null
}

export interface OAuthSupport {
  /** Env vars the platform needs for this network's sign-in. */
  env: string[]
  /** PKCE: the challenge is passed when the network needs one. */
  authorizeUrl(redirectUri: string, state: string, codeChallenge: string): string
  exchange(code: string, redirectUri: string, codeVerifier: string): Promise<TokenSet>
  /** New tokens from the refresh token; networks that rotate return the new refresh token too. */
  refresh?(auth: SocialAuth): Promise<TokenSet>
  /** Where a post can go for this sign-in, for the picker. */
  listTargets(token: string): Promise<{ id: string; name: string }[]>
}

export interface SocialProvider {
  network: Network
  label: string
  limits: { caption: number; title?: number; hashtags?: number }
  /** What a post must carry. */
  requires: { image?: boolean; video?: boolean }
  oauth?: OAuthSupport
  publish(auth: SocialAuth, input: PublishInput): Promise<PublishResult>
  metrics?(auth: SocialAuth, externalIds: string[]): Promise<Record<string, PostMetrics>>
  inbox?(auth: SocialAuth, postExternalIds: string[]): Promise<InboxItem[]>
  reply?(auth: SocialAuth, item: { externalId: string; kind: 'comment' | 'review' }, text: string): Promise<void>
}

/** The store's own app (client id and secret saved with a manual connection), used only for its own tokens. */
export function ownApp(auth: Pick<SocialAuth, 'extra'>): { clientId: string; clientSecret: string } | null {
  const clientId = auth.extra?.clientId
  const clientSecret = auth.extra?.clientSecret
  return clientId && clientSecret ? { clientId, clientSecret } : null
}

export class SocialApiError extends Error {
  constructor(
    public network: Network,
    public httpStatus: number,
    message: string
  ) {
    super(message)
    this.name = 'SocialApiError'
  }
}

/** Caption cut to the network's limit, keeping whole words where it can. */
export function fitText(text: string, max: number): string {
  if (text.length <= max) return text
  const cut = text.slice(0, max - 1)
  const space = cut.lastIndexOf(' ')
  return `${(space > max * 0.7 ? cut.slice(0, space) : cut).trimEnd()}…`
}

/** Hashtags kept to the network's cap, de-duplicated, each a single #word. */
export function fitHashtags(tags: string, max: number | undefined): string {
  const list = [...new Set((tags.match(/#[\p{L}\p{N}_]+/gu) ?? []).map(t => t.toLowerCase()))]
  return (max == null ? list : list.slice(0, max)).join(' ')
}
