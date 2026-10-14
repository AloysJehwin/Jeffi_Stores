import { controlPlanePool } from './shared'

// Messaging/Documents access needs Jeffi's approval. No row = approved (workspaces from before
// approvals existed); a 'pending' / 'rejected' row blocks sending and rendering.

export type ApprovalService = 'messaging' | 'documents'
export interface ServiceApproval { service: ApprovalService; status: 'pending' | 'approved' | 'rejected'; requested_at: string; reviewed_at: string | null; note: string | null }

export async function listServiceApprovals(tenantId: string): Promise<ServiceApproval[]> {
  const r = await controlPlanePool().query<ServiceApproval>(
    `SELECT service, status, requested_at, reviewed_at, note FROM tenant_service_approvals WHERE tenant_id = $1 ORDER BY service`, [tenantId])
  return r.rows
}

/** Open (or re-open after a rejection) an approval request. Already-approved services stay approved. */
export async function requestServiceApproval(tenantId: string, services: ApprovalService[]) {
  await controlPlanePool().query(
    `INSERT INTO tenant_service_approvals (tenant_id, service) SELECT $1, s FROM unnest($2::text[]) s
     ON CONFLICT (tenant_id, service) DO UPDATE SET status = 'pending', requested_at = now(), reviewed_at = NULL, note = NULL
       WHERE tenant_service_approvals.status = 'rejected'`, [tenantId, services])
}

export async function reviewServiceApproval(tenantId: string, services: ApprovalService[] | 'all-pending', decision: 'approved' | 'rejected', reviewerId: string | null, note?: string | null) {
  const r = await controlPlanePool().query<{ service: string }>(
    `UPDATE tenant_service_approvals SET status = $2, reviewed_at = now(), reviewed_by = $3, note = $4
      WHERE tenant_id = $1 AND status = 'pending' AND ($5::text[] IS NULL OR service = ANY($5))
      RETURNING service`,
    [tenantId, decision, reviewerId, note ?? null, services === 'all-pending' ? null : services])
  return r.rows.map(x => x.service as ApprovalService)
}

export const blockedServices = (rows: ServiceApproval[]) =>
  new Map(rows.filter(r => r.status !== 'approved').map(r => [r.service, r.status as 'pending' | 'rejected']))
