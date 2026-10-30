// Scenario-to-template fill: one aiChat() call returns a JSON template body + optional image prompt;
// a configured image provider (razer/gemini via the gateway's provider policy — never Replicate here)
// generates the header image when the channel supports one. Chat billing fires through aiChat's own
// usage logger (feature='template_scenario_fill', capability='text'); the image is billed through
// generateImage's preauthorize/settle path. credentialOwnerId() routes charges automatically:
// a tenant admin pays public pricing; a flagship/library call charges the platform at zero.
import { createHash } from 'node:crypto'

import { aiChat } from '@/lib/shared/ai-client'
import { parseAiJson } from '@/lib/auth/ai-scope'
import { generateImage, AiMediaError } from './media'
import { AiWalletError } from './billing'
import {
  CHANNEL_SUPPORTS_IMAGE,
  type TemplateChannel,
  type TemplateImageAspect,
  type TemplateScenarioFill,
  type TemplateScenarioRequest,
  TemplateScenarioFill as FillSchema,
} from './template-scenario.schema'

// adminId + scenarioText hash → ms of last fire. One call per 10s per (admin, scenario).
const RATE_WINDOW_MS = 10_000
const rateCache = new Map<string, number>()

function hashScenario(text: string): string {
  return createHash('sha1').update(text).digest('hex').slice(0, 12)
}

/** Returns true when the call may proceed; false means the admin must wait a few seconds. */
export function rateLimit(adminId: string, scenarioText: string, nowMs: number = Date.now()): boolean {
  const key = `${adminId}:${hashScenario(scenarioText)}`
  const last = rateCache.get(key)
  if (last && nowMs - last < RATE_WINDOW_MS) return false
  rateCache.set(key, nowMs)
  if (rateCache.size > 1024) {
    for (const [k, t] of rateCache) if (nowMs - t > RATE_WINDOW_MS * 4) rateCache.delete(k)
  }
  return true
}

/** Test hook. */
export function __resetTemplateScenarioState(): void {
  rateCache.clear()
}

// Within the gateway's 256..1536 window and multiples of 64 so the model's aspect holds.
function aspectToSize(a: TemplateImageAspect): { width: number; height: number } {
  switch (a) {
    case '16:9': return { width: 1344, height: 768 }
    case '9:16': return { width: 832, height: 1472 }
    case '4:5': return { width: 1024, height: 1280 }
    default: return { width: 1024, height: 1024 }
  }
}

function systemPrompt(req: TemplateScenarioRequest, supportsImage: boolean): string {
  const brand = req.tenantContext.storeName
  const extras = [
    req.tenantContext.brandAccent ? `Accent colour: ${req.tenantContext.brandAccent}` : null,
    req.tenantContext.categoryTheme ? `Category: ${req.tenantContext.categoryTheme}` : null,
    req.tenantContext.defaultLocale ? `Default locale: ${req.tenantContext.defaultLocale}` : null,
  ].filter(Boolean).join('. ')

  const channel = req.channel.toUpperCase()
  const mode = req.templateMode.toUpperCase()

  const imageKey = supportsImage ? '\n  "image_prompt": "<one-line description of the header image, or empty string>",' : ''
  const emailKeys = req.channel === 'email' ? '\n  "subject": "<subject line>",\n  "preview": "<preheader>",' : ''

  return `You draft messaging templates for ${brand}${extras ? '. ' + extras : ''}.
Channel: ${channel}. Template type: ${mode}.
Return STRICT JSON only (no prose, no markdown fences) with this shape:
{
  "name": "<short internal label>",
  "body": "<the message body, with {{1}}, {{2}} ... for variables>",
  "placeholders": ["{{1}} short description", "{{2}} short description"],
  "buttons": [{ "type": "quick_reply" | "url" | "phone", "label": "<label>", "value": "<url or phone or payload>" }],${imageKey}${emailKeys}
}
Rules:
- Keep body concise and on-brand; no marketing fluff.
- WhatsApp: up to 3 buttons; obey Meta ${mode} rules (no promotional claims in UTILITY/AUTHENTICATION).
- SMS: no buttons; body under 300 chars; placeholders only where the scenario clearly needs them.
- Email: body is plain readable text; subject under 60 chars; preview under 90 chars.
- Prefer {{1}}, {{2}}, ... tokens so the admin can map variables later.
- Button labels are at most 25 characters.
- Only include keys shown above; omit buttons as [] when the scenario does not require them.`
}

function userPrompt(req: TemplateScenarioRequest): string {
  return `Scenario: ${req.scenarioText}

Compose the ${req.channel} template now.`
}

interface RawFill {
  name?: unknown
  body?: unknown
  placeholders?: unknown
  buttons?: unknown
  image_prompt?: unknown
  subject?: unknown
  preview?: unknown
  blocks?: unknown
}

function coerce(raw: RawFill, channel: TemplateChannel): TemplateScenarioFill {
  const name = typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim() : `${channel} template`
  const body = typeof raw.body === 'string' ? raw.body : ''
  const placeholders = Array.isArray(raw.placeholders)
    ? raw.placeholders.filter((x): x is string => typeof x === 'string')
    : []
  const buttons = Array.isArray(raw.buttons)
    ? raw.buttons
        .filter((b): b is Record<string, unknown> => !!b && typeof b === 'object')
        .map(b => ({
          type: typeof b.type === 'string' && ['quick_reply', 'url', 'phone'].includes(b.type) ? (b.type as 'quick_reply' | 'url' | 'phone') : 'quick_reply',
          label: typeof b.label === 'string' ? b.label : '',
          value: typeof b.value === 'string' ? b.value : undefined,
        }))
        .filter(b => b.label.length > 0)
    : []
  return FillSchema.parse({
    name,
    body,
    placeholders,
    buttons,
    image_prompt: typeof raw.image_prompt === 'string' && raw.image_prompt.trim() ? raw.image_prompt.trim() : undefined,
    subject: typeof raw.subject === 'string' && raw.subject.trim() ? raw.subject.trim() : undefined,
    preview: typeof raw.preview === 'string' && raw.preview.trim() ? raw.preview.trim() : undefined,
    blocks: raw.blocks && typeof raw.blocks === 'object' && !Array.isArray(raw.blocks) ? (raw.blocks as Record<string, unknown>) : undefined,
  })
}

/** Returns a filled template plus (optionally) a header image URL. Chat usage is billed inside
 *  aiChat() via feature='template_scenario_fill'; image usage is billed inside generateImage(). */
export async function fillFromScenario(
  req: TemplateScenarioRequest,
  tenantId: string | null,
  isPlatformLibrary: boolean,
  actor: string | null = null
): Promise<TemplateScenarioFill> {
  const supportsImage = CHANNEL_SUPPORTS_IMAGE[req.channel]
  const refTag = isPlatformLibrary ? 'template_scenario:library' : 'template_scenario:tenant'

  const chat = await aiChat({
    feature: 'template_scenario_fill',
    modelHint: 'copy',
    jsonMode: true,
    temperature: 0.4,
    noCache: true,
    messages: [
      { role: 'system', content: systemPrompt(req, supportsImage) },
      { role: 'user', content: userPrompt(req) },
    ],
  })
  const raw = parseAiJson<RawFill>(chat.content)
  if (!raw || typeof raw !== 'object') {
    throw new TemplateScenarioError('AI returned an unparseable response', 502)
  }
  const fill = coerce(raw, req.channel)
  if (!fill.body.trim()) {
    throw new TemplateScenarioError('AI returned an empty template body', 502)
  }

  if (req.includeImage && supportsImage && fill.image_prompt) {
    const { width, height } = aspectToSize(req.imageAspect)
    try {
      const r = await generateImage({
        feature: 'template_scenario_image',
        prompt: fill.image_prompt,
        width,
        height,
        n: 1,
        quality: 'standard',
        tenantId,
        actor,
        ref: refTag,
      })
      const url = r.images[0]?.url
      if (url) fill.image_url = url
    } catch (err) {
      // A failed image must not drop the body on the floor — the admin can retry images from the editor.
      if (err instanceof AiWalletError || err instanceof AiMediaError) {
        console.warn('[template-scenario] image generation skipped:', err.message)
      } else {
        throw err
      }
    }
  }
  return fill
}

export class TemplateScenarioError extends Error {
  constructor(
    message: string,
    public readonly status: number
  ) {
    super(message)
    this.name = 'TemplateScenarioError'
  }
}
