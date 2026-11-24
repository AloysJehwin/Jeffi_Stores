'use client'

import type { AttentionItem } from '@/components/admin/overview/kit'
import { ap } from '@/lib/shared/admin-path'
import type { Attention } from '@/lib/traffic/types'

export { Change, Note, PointChange, bucketLabel, rateText, ratio } from '@/components/admin/traffic/shared'

export const toAttention = (items: Attention[]): AttentionItem[] => items.map(i => ({ ...i, href: i.href ? ap(i.href) : undefined }))

export const productHref = (id: string) => ap(`/admin/products/${id}`)
