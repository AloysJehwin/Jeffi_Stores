// Ops scripts reach a model only through the AI gateway (AI_GATEWAY_URL + AI_GATEWAY_TOKEN), like the apps do
// through store-core's ai-client. The gateway owns provider order, fallback and models; scripts never call a provider.

export function gatewayUrl() {
  const base = (process.env.AI_GATEWAY_URL || '').replace(/\/$/, '')
  if (!base) throw new Error('AI_GATEWAY_URL is not set: scripts reach models only through the AI gateway')
  return base
}

export async function gatewayPost(path, body, { timeoutMs = 120_000 } = {}) {
  const token = (process.env.AI_GATEWAY_TOKEN || '').trim()
  const res = await fetch(`${gatewayUrl()}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  })
  if (!res.ok) throw new Error(`AI gateway ${path} HTTP ${res.status}: ${(await res.text().catch(() => '')).slice(0, 300)}`)
  return res.json()
}

/** Vectors plus the model that made them; store `model` with each vector (embeddings.embedding_model). */
export async function gatewayEmbed(input, { provider, model, timeoutMs } = {}) {
  const r = await gatewayPost('/v1/embed', { input, ...(provider ? { provider } : {}), ...(model ? { model } : {}) }, { timeoutMs })
  if (!Array.isArray(r.embeddings)) throw new Error('AI gateway embed returned no embeddings')
  const used = r.provider || provider || ''
  return { vectors: r.embeddings, model: r.model || (used === 'azure' ? 'text-embedding-3-small@768' : 'nomic-embed-text'), provider: used }
}

export function gatewayChat(req, { timeoutMs } = {}) {
  return gatewayPost('/v1/chat', req, { timeoutMs })
}

export async function gatewaySpeak(req, { timeoutMs } = {}) {
  const r = await gatewayPost('/v1/audio/speak', req, { timeoutMs })
  if (typeof r.audioBase64 !== 'string') throw new Error('AI gateway speak returned no audio')
  return { audio: Buffer.from(r.audioBase64, 'base64'), mimeType: r.mimeType || 'audio/mpeg', provider: r.provider, model: r.model }
}
