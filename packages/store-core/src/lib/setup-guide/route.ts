import { z } from 'zod'
import { MANUAL_STATES } from './progress'

// Shared by the setup-guide API routes.

const PLATFORM_TENANT = '00000000-0000-0000-0000-000000000000'

/** The store this request is for; null on the flagship. */
export async function setupTenantId(): Promise<string | null> {
  const { resolveTenantId } = await import('@/lib/tenancy/tenant-context')
  const id = await resolveTenantId()
  return id && id !== PLATFORM_TENANT ? id : null
}

export const ManualBody = z.object({
  state: z.enum(MANUAL_STATES).nullable(),
  appliedAt: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a YYYY-MM-DD date')
    .refine(d => !Number.isNaN(Date.parse(d)) && Date.parse(d) <= Date.now() + 86_400_000, 'Not a valid date')
    .nullable()
    .optional(),
  note: z.string().trim().max(500).nullable().optional(),
})

export const issue = (e: z.ZodError) => e.issues[0]?.message ?? 'Invalid request'
