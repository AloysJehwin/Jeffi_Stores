// Request/response schemas for /api/admin/ai/template-scenario.
// Button and placeholder shapes mirror packages/api-contracts/src/index.ts (WaButton / TemplateBlocks)
// so an admin can hand the fill straight to the template upsert without reshaping.
import { z } from 'zod'

export const TemplateChannel = z.enum(['whatsapp', 'sms', 'email'])
export type TemplateChannel = z.infer<typeof TemplateChannel>

export const TemplateMode = z.enum(['marketing', 'utility', 'authentication', 'transactional'])
export type TemplateMode = z.infer<typeof TemplateMode>

export const TemplateImageAspect = z.enum(['1:1', '16:9', '9:16', '4:5'])
export type TemplateImageAspect = z.infer<typeof TemplateImageAspect>

export const TenantContext = z.object({
  storeName: z.string().min(1).max(120),
  brandAccent: z.string().max(32).optional(),
  categoryTheme: z.string().max(80).optional(),
  defaultLocale: z.string().max(10).optional(),
})
export type TenantContext = z.infer<typeof TenantContext>

export const TemplateScenarioRequest = z.object({
  channel: TemplateChannel,
  scenarioText: z.string().trim().min(3).max(500),
  templateMode: TemplateMode,
  tenantContext: TenantContext,
  includeImage: z.boolean().default(false),
  imageAspect: TemplateImageAspect.default('1:1'),
  // Caller hint: a library template is owned by the platform (internal pricing); a store template
  // is owned by the caller tenant (public pricing). Defaults to tenant-owned.
  isPlatformLibrary: z.boolean().default(false),
})
export type TemplateScenarioRequest = z.infer<typeof TemplateScenarioRequest>

// Matches the WaButton shape in packages/api-contracts/src/index.ts (quick_reply/url/phone + label + value).
export const TemplateFillButton = z.object({
  type: z.enum(['quick_reply', 'url', 'phone']),
  label: z.string().min(1).max(25),
  value: z.string().max(2000).optional(),
})
export type TemplateFillButton = z.infer<typeof TemplateFillButton>

export const TemplateScenarioFill = z.object({
  name: z.string().min(1).max(120),
  body: z.string().min(1).max(20000),
  placeholders: z.array(z.string().max(120)).max(20).default([]),
  buttons: z.array(TemplateFillButton).max(3).default([]),
  image_url: z.string().url().optional(),
  image_prompt: z.string().max(600).optional(),
  subject: z.string().max(200).optional(),
  preview: z.string().max(200).optional(),
  blocks: z.record(z.string(), z.unknown()).optional(),
})
export type TemplateScenarioFill = z.infer<typeof TemplateScenarioFill>

export const CHANNEL_SUPPORTS_IMAGE: Record<TemplateChannel, boolean> = {
  whatsapp: true,
  email: true,
  sms: false,
}
