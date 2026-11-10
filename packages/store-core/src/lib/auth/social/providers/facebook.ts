import crypto from 'crypto'
import { META_GRAPH, META_GRAPH_VERSION } from '@/lib/catalog/meta'
import { SocialProviderError, fetchJson, type SocialProviderModule } from './shared'

export const facebook: SocialProviderModule = {
  authorizeUrl({ creds, redirectUri, state }) {
    const qs = new URLSearchParams({
      client_id: creds.clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: 'email,public_profile',
      state,
    })
    return `https://www.facebook.com/${META_GRAPH_VERSION}/dialog/oauth?${qs}`
  },
  async exchange({ creds, redirectUri, code }) {
    const secret = creds.clientSecret || ''
    const token = await fetchJson(
      `${META_GRAPH}/oauth/access_token?${new URLSearchParams({ client_id: creds.clientId, client_secret: secret, redirect_uri: redirectUri, code })}`
    )
    if (!token.access_token) throw new SocialProviderError('no access token')
    const proof = crypto.createHmac('sha256', secret).update(token.access_token).digest('hex')
    const me = await fetchJson(
      `${META_GRAPH}/me?${new URLSearchParams({ fields: 'id,email,first_name,last_name,picture.type(large)', access_token: token.access_token, appsecret_proof: proof })}`
    )
    if (!me.id) throw new SocialProviderError('no subject')
    const pic = me.picture?.data
    return {
      subject: String(me.id),
      email: me.email ? String(me.email).toLowerCase() : null,
      // Facebook only returns an email it has confirmed.
      emailVerified: !!me.email,
      firstName: me.first_name || '',
      lastName: me.last_name || '',
      picture: pic?.url && !pic.is_silhouette ? pic.url : null,
    }
  },
}
