import { controlPlanePool } from '@/lib/tenant-registry'

// Outreach tables are platform-only: they live in the flagship DB, reached through the control-plane pool.
export const outreachPool = () => controlPlanePool()

export interface Queryable {
  query: (text: string, params?: unknown[]) => Promise<{ rows: any[]; rowCount?: number | null }>
}
