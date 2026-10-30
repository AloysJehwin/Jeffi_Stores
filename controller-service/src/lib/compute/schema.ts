import { z } from 'zod'
import { SERVICE_NAMES } from './spec'

const service = z.object({
  replicas: z.number().int().min(1).max(10),
  maxReplicas: z.number().int().min(1).max(10),
  size: z.enum(['S', 'M', 'L']),
})

export const ComputeSpecSchema = z.object({
  node: z.object({
    placement: z.enum(['pool', 'dedicated']),
    type: z.string().max(40).nullable(),
    count: z.number().int().min(1).max(3),
  }),
  db: z.object({
    mode: z.enum(['shared', 'dedicated']),
    class: z.string().max(40).nullable(),
    storageGb: z.number().int().min(1).max(1000),
    multiAz: z.boolean(),
  }),
  services: z.object(Object.fromEntries(SERVICE_NAMES.map(n => [n, service])) as Record<(typeof SERVICE_NAMES)[number], typeof service>),
})
