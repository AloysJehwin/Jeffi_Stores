import { z } from 'zod'
import { BUILTIN_VARIABLE_KEYS, VARIABLE_KEY_RE } from '@/lib/templates/variables-shared'

export const zVariableKey = z
  .string()
  .trim()
  .min(1, 'Key is required')
  .max(64, 'Key must be at most 64 characters')
  .regex(VARIABLE_KEY_RE, 'Use lowercase letters, digits and underscores, starting with a letter or underscore')
  .refine(k => !BUILTIN_VARIABLE_KEYS.has(k), 'This key is a built-in variable')

export const CreateSchema = z.object({
  key: zVariableKey,
  label: z.string().trim().min(1, 'Label is required').max(120),
  description: z.string().trim().max(2000).optional().default(''),
  value: z.string().max(5000).optional().default(''),
  isEnabled: z.boolean().optional().default(true),
})

export const UpdateSchema = z
  .object({
    key: zVariableKey.optional(),
    label: z.string().trim().min(1, 'Label is required').max(120).optional(),
    description: z.string().trim().max(2000).optional(),
    value: z.string().max(5000).optional(),
    isEnabled: z.boolean().optional(),
  })
  .refine(v => Object.keys(v).length > 0, 'Nothing to update')
