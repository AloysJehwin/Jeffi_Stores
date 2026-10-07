import { z } from 'zod'

const days = (max: number) => z.number().int().min(0).max(max)

/** Strict validation for admin writes (the runtime parser is lenient and never throws). */
export const eddSettingsSchema = z
  .object({
    handlingDays: days(30),
    sameCityDays: days(60),
    sameRegionDays: days(60),
    metroDays: days(60),
    restDays: days(60),
    remoteDays: days(60),
    metroPrefixes: z
      .array(
        z
          .string()
          .trim()
          .regex(/^\d{3}$/, 'Metro prefixes must be 3 digits')
      )
      .max(300)
      .transform(a => [...new Set(a)]),
    skipSundays: z.boolean(),
  })
  .strict()
