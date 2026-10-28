import Anthropic from '@anthropic-ai/sdk'
import { CONFIG, CLAUDE_VISION_MODEL, claudeModelForHint } from '../config'
import { anthropicUsage } from '../pricing'
import {
  AiClientError, type AiChatMessage, type AiChatRequest, type AiChatStreamEvent, type AiToolCall,
  type AiToolDef, type AnthropicIdentity, type TokenUsage, type VisionRequest, type VisionResponse,
} from '../../../sdk/types'

// Claude text provider (Messages API via the official SDK). Maps the gateway's Ollama-shaped chat
// request to Anthropic and back: system messages -> top-level system, tool_calls/tool messages ->
// tool_use/tool_result blocks. Assistant turns carry their raw content back in providerState so
// thinking blocks replay unchanged inside a tool loop.

type MessageParam = Anthropic.Beta.Messages.BetaMessageParam
type ContentBlockParam = Anthropic.Beta.Messages.BetaContentBlockParam
type Tool = Anthropic.Beta.Messages.BetaTool
type Message = Anthropic.Beta.Messages.BetaMessage
type Params = Anthropic.Beta.Messages.MessageCreateParamsNonStreaming

export interface AnthropicChatResult {
  content: string
  toolCalls?: AiToolCall[]
  model: string
  usage: TokenUsage
  providerState: { provider: 'anthropic'; content: unknown[] }
  stopReason: string
}

const clients = new Map<string, Anthropic>()
const base = () => ({ maxRetries: 1, timeout: CONFIG.anthropicTimeoutMs }) // one retry, then fail over to Razer

function wifReady(): boolean {
  return !!(CONFIG.anthropicOrganizationId && CONFIG.anthropicIdentityTokenFile)
}

/** Gateway-wide: some Claude auth path exists (per-store WIF or the dev key). */
export function anthropicConfigured(): boolean {
  return wifReady() || !!CONFIG.anthropicApiKey
}

/**
 * Client for one store: its workspace-scoped WIF identity (the SDK exchanges the projected k8s
 * token for an access token and refreshes it), else the dev key, else null (caller falls back).
 * Cached per store + ids, so a re-provisioned identity gets a fresh client.
 */
export function clientFor(identity: AnthropicIdentity | undefined, namespace = 'platform'): Anthropic | null {
  if (identity?.workspaceId && identity.serviceAccountId && identity.federationRuleId && wifReady()) {
    const key = `wif:${namespace}:${identity.workspaceId}:${identity.serviceAccountId}:${identity.federationRuleId}`
    let c = clients.get(key)
    if (!c) {
      c = new Anthropic({
        ...base(),
        // Explicit nulls, or ANTHROPIC_API_KEY in the env would win over the federation config.
        apiKey: null,
        authToken: null,
        config: {
          organization_id: CONFIG.anthropicOrganizationId,
          workspace_id: identity.workspaceId,
          authentication: {
            type: 'oidc_federation',
            federation_rule_id: identity.federationRuleId,
            service_account_id: identity.serviceAccountId,
            identity_token: { source: 'file', path: CONFIG.anthropicIdentityTokenFile },
          },
        },
      })
      clients.set(key, c)
    }
    return c
  }
  if (!CONFIG.anthropicApiKey) return null
  let c = clients.get('key')
  if (!c) clients.set('key', (c = new Anthropic({ ...base(), apiKey: CONFIG.anthropicApiKey })))
  return c
}

export function anthropicAvailable(req: { anthropicIdentity?: AnthropicIdentity; cacheNamespace?: string }): boolean {
  return !!clientFor(req.anthropicIdentity, req.cacheNamespace)
}

function requireClient(req: { anthropicIdentity?: AnthropicIdentity; cacheNamespace?: string }): Anthropic {
  const c = clientFor(req.anthropicIdentity, req.cacheNamespace)
  if (!c) throw new AiClientError('Anthropic: no identity for this store and no dev key', 'anthropic')
  return c
}

const JSON_ONLY = 'Respond with a single valid JSON value only: no prose, no markdown code fences.'

export function toAnthropic(req: AiChatRequest): { system: string; messages: MessageParam[]; tools?: Tool[] } {
  const system: string[] = []
  const out: MessageParam[] = []
  let pending: string[] = []
  let gen = 0

  const userBlocks = (): ContentBlockParam[] => {
    const last = out[out.length - 1]
    if (last?.role === 'user' && Array.isArray(last.content)) return last.content as ContentBlockParam[]
    const blocks: ContentBlockParam[] = []
    out.push({ role: 'user', content: blocks })
    return blocks
  }
  // Every tool_use needs a tool_result before the next assistant turn.
  const closePending = () => {
    if (!pending.length) return
    const blocks = userBlocks()
    for (const id of pending) blocks.push({ type: 'tool_result', tool_use_id: id, content: '(no result recorded)', is_error: true })
    pending = []
  }

  for (const m of req.messages) {
    if (m.role === 'system') {
      if (m.content) system.push(m.content)
      continue
    }
    if (m.role === 'user') {
      if (m.content.trim()) userBlocks().push({ type: 'text', text: m.content })
      continue
    }
    if (m.role === 'tool') {
      const id = m.tool_call_id && pending.includes(m.tool_call_id) ? m.tool_call_id : pending[0]
      if (id) {
        pending = pending.filter(p => p !== id)
        userBlocks().push({ type: 'tool_result', tool_use_id: id, content: m.content || '(empty)' })
      } else if (m.content) {
        userBlocks().push({ type: 'text', text: `Tool result:\n${m.content}` })
      }
      continue
    }
    // assistant
    closePending()
    const raw = replayable(m)
    if (raw) {
      out.push({ role: 'assistant', content: raw })
      pending = raw.filter((b: any) => b?.type === 'tool_use').map((b: any) => String(b.id))
      continue
    }
    const blocks: ContentBlockParam[] = []
    if (m.content.trim()) blocks.push({ type: 'text', text: m.content })
    for (const tc of m.tool_calls ?? []) {
      const id = safeId(tc.id) || `toolu_gen_${gen++}`
      blocks.push({ type: 'tool_use', id, name: tc.function.name, input: tc.function.arguments ?? {} })
      pending.push(id)
    }
    if (blocks.length) out.push({ role: 'assistant', content: blocks })
  }
  closePending()

  // Sort each user turn so tool_result blocks lead (API requirement).
  for (const msg of out) {
    if (msg.role === 'user' && Array.isArray(msg.content)) {
      const c = msg.content as ContentBlockParam[]
      msg.content = [...c.filter(b => b.type === 'tool_result'), ...c.filter(b => b.type !== 'tool_result')]
    }
  }
  if (!out.length || out[0].role !== 'user') out.unshift({ role: 'user', content: [{ type: 'text', text: '(continuing the conversation)' }] })
  // No assistant prefill on current models: the last turn must be the user's.
  if (out[out.length - 1].role === 'assistant') out.push({ role: 'user', content: [{ type: 'text', text: 'Continue.' }] })

  if (req.jsonMode) system.push(JSON_ONLY)
  const tools = req.tools?.length ? req.tools.map(toTool) : undefined
  return { system: system.join('\n\n'), messages: out, tools }
}

function replayable(m: AiChatMessage): ContentBlockParam[] | null {
  const s = m.providerState
  if (s?.provider !== 'anthropic' || !Array.isArray(s.content) || !s.content.length) return null
  return s.content as ContentBlockParam[]
}

function safeId(id: string | undefined): string | undefined {
  return id && /^[A-Za-z0-9_-]{1,128}$/.test(id) ? id : undefined
}

function toTool(t: AiToolDef): Tool {
  const schema = (t.function.parameters || {}) as Record<string, unknown>
  return {
    name: t.function.name,
    description: t.function.description,
    input_schema: { ...schema, type: 'object' } as Tool['input_schema'],
  }
}

function buildParams(req: AiChatRequest): Params {
  const { model, effort } = claudeModelForHint(req.modelHint)
  const { system, messages, tools } = toAnthropic(req)
  // Cache the stable prefix: last tool (covers all tools) and the system prompt, plus the
  // automatic breakpoint on the conversation so a tool loop reuses the previous turns.
  if (tools?.length) tools[tools.length - 1] = { ...tools[tools.length - 1], cache_control: { type: 'ephemeral' } }
  const params: Params = {
    model,
    max_tokens: Math.max(req.maxTokens ?? 0, CONFIG.anthropicMinMaxTokens),
    messages,
    output_config: { effort },
    cache_control: { type: 'ephemeral' },
  }
  if (system) params.system = [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }]
  if (tools?.length) params.tools = tools
  // Refusal fallback (routes by refusal category); Haiku has none.
  if (CONFIG.anthropicFallbacks && /^claude-(sonnet|opus)-5-5/.test(model)) {
    params.betas = ['server-side-fallback-2026-07-01']
    params.fallbacks = 'default'
  }
  return params
}

/** One Claude turn. Streams text deltas and tool-call starts through `emit` when given. */
export async function anthropicChat(req: AiChatRequest, emit?: (e: AiChatStreamEvent) => void, signal?: AbortSignal): Promise<AnthropicChatResult> {
  const params = buildParams(req)
  let msg: Message
  try {
    const stream = requireClient(req).beta.messages.stream(params, { signal })
    for await (const ev of stream) {
      if (!emit) continue
      if (ev.type === 'content_block_delta' && ev.delta.type === 'text_delta') emit({ type: 'text', text: ev.delta.text })
      else if (ev.type === 'content_block_start' && ev.content_block.type === 'tool_use') {
        emit({ type: 'tool_call', id: ev.content_block.id, name: ev.content_block.name })
      }
    }
    msg = await stream.finalMessage()
  } catch (err) {
    throw new AiClientError(`Anthropic: ${describe(err)}`, 'anthropic', err)
  }
  return fromAnthropic(msg, req.jsonMode)
}

export function fromAnthropic(msg: Message, jsonMode?: boolean): AnthropicChatResult {
  const model = msg.model
  const usage = anthropicUsage(model, msg.usage)
  // A tool_use cut off by max_tokens may carry partial input; never hand it to a tool.
  if (msg.stop_reason === 'max_tokens' && msg.content.some(b => b.type === 'tool_use')) {
    throw new AiClientError('Anthropic: tool input truncated by max_tokens', 'anthropic')
  }
  let text = msg.content.filter(b => b.type === 'text').map(b => (b as { text: string }).text).join('')
  if (msg.stop_reason === 'refusal' && !text.trim()) text = "I can't help with that request."
  if (jsonMode) text = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim()
  const toolCalls: AiToolCall[] = msg.content
    .filter(b => b.type === 'tool_use')
    .map(b => {
      const t = b as { id: string; name: string; input: unknown }
      return { id: t.id, name: t.name, arguments: (t.input && typeof t.input === 'object' ? t.input : {}) as Record<string, unknown> }
    })
  return {
    content: text,
    toolCalls: toolCalls.length ? toolCalls : undefined,
    model,
    usage,
    providerState: { provider: 'anthropic', content: msg.content as unknown[] },
    stopReason: msg.stop_reason ?? '',
  }
}

/** Vision/OCR with Claude. Throws on failure so the caller can fall back to PaddleOCR/Ollama. */
export async function anthropicVision(req: VisionRequest): Promise<VisionResponse> {
  const { images, prompt } = req
  const content: ContentBlockParam[] = images.map(data => ({
    type: 'image',
    source: { type: 'base64', media_type: imageMime(data), data },
  }))
  content.push({ type: 'text', text: prompt })
  let msg: Message
  try {
    msg = await requireClient(req).beta.messages.stream({
      model: CLAUDE_VISION_MODEL,
      max_tokens: Math.max(16000, CONFIG.anthropicMinMaxTokens),
      output_config: { effort: 'low' },
      messages: [{ role: 'user', content }],
    }).finalMessage()
  } catch (err) {
    throw new AiClientError(`Anthropic vision: ${describe(err)}`, 'anthropic', err)
  }
  const text = msg.content.filter(b => b.type === 'text').map(b => (b as { text: string }).text).join('').trim()
  return { ok: !!text, text, model: msg.model, provider: 'anthropic', pages: images.length, usage: anthropicUsage(msg.model, msg.usage) }
}

function imageMime(b64: string): 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp' {
  if (b64.startsWith('/9j/')) return 'image/jpeg'
  if (b64.startsWith('R0lGOD')) return 'image/gif'
  if (b64.startsWith('UklGR')) return 'image/webp'
  return 'image/png'
}

function describe(err: unknown): string {
  if (err instanceof Anthropic.APIError) return `HTTP ${err.status ?? '?'} ${err.message}`.slice(0, 500)
  return err instanceof Error ? err.message : String(err)
}
