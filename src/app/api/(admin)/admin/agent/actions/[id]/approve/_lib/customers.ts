import { query, queryOne } from '@/lib/shared/db'
import { logActivity } from '@/lib/shared/activity'
import type { AgentAction, ActionResult } from './shared'

export async function addCustomerNote(action: AgentAction): Promise<ActionResult> {
  const { customerId, body } = action.payload as { customerId: string; body: string; isPrivate?: boolean }
  const text = String(body || '').trim()
  if (!customerId || !text) return { result: null, error: 'customerId and body required' }
  if (text.length > 2000) return { result: null, error: 'body too long (max 2000 chars)' }
  await query(`INSERT INTO customer_notes (user_id, body, admin_id) VALUES ($1::uuid, $2, $3::uuid)`, [
    customerId,
    text,
    action.admin_id,
  ])
  await logActivity({
    userId: customerId,
    actorId: action.admin_id,
    kind: 'note_added',
    summary: text.length > 120 ? text.slice(0, 120) + '…' : text,
  }).catch(() => {})
  return { result: { customerId, length: text.length }, error: null }
}

export async function addCustomerTag(action: AgentAction): Promise<ActionResult> {
  const { customerId, tagSlug } = action.payload as { customerId: string; tagSlug: string }
  const slug = String(tagSlug || '')
    .trim()
    .toLowerCase()
  if (!customerId || !slug) return { result: null, error: 'customerId and tagSlug required' }
  await query(
    `INSERT INTO customer_tags (user_id, tag, created_by) VALUES ($1::uuid, $2, $3::uuid)
    ON CONFLICT (user_id, tag) DO NOTHING`,
    [customerId, slug, action.admin_id]
  )
  await logActivity({
    userId: customerId,
    actorId: action.admin_id,
    kind: 'tag_added',
    summary: `Tag "${slug}" added`,
    metadata: { tag: slug, via: 'agent' },
  }).catch(() => {})
  return { result: { customerId, tag: slug }, error: null }
}

export async function removeCustomerTag(action: AgentAction): Promise<ActionResult> {
  const { customerId, tagSlug } = action.payload as { customerId: string; tagSlug: string }
  const slug = String(tagSlug || '')
    .trim()
    .toLowerCase()
  if (!customerId || !slug) return { result: null, error: 'customerId and tagSlug required' }
  const r = await query(`DELETE FROM customer_tags WHERE user_id = $1::uuid AND tag = $2`, [customerId, slug])
  await logActivity({
    userId: customerId,
    actorId: action.admin_id,
    kind: 'tag_removed',
    summary: `Tag "${slug}" removed`,
    metadata: { tag: slug, via: 'agent' },
  }).catch(() => {})
  return { result: { customerId, tag: slug, removed: r.rowCount ?? 0 }, error: null }
}

export async function createCustomerTask(action: AgentAction): Promise<ActionResult> {
  const { customerId, title, dueAt, assignedToAdminId, priority } = action.payload as {
    customerId: string
    title: string
    dueAt: string | null
    assignedToAdminId: string | null
    priority: string
  }
  const t = String(title || '')
    .trim()
    .slice(0, 255)
  if (!customerId || !t) return { result: null, error: 'customerId and title required' }
  const validPriorities = ['low', 'medium', 'high', 'urgent']
  const pr = validPriorities.includes(priority) ? priority : 'medium'
  const assignee = assignedToAdminId || action.admin_id
  const inserted = await queryOne<{ id: string }>(
    `INSERT INTO customer_tasks (user_id, created_by, assigned_to, title, due_date, priority)
     VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5, $6) RETURNING id::text`,
    [customerId, action.admin_id, assignee, t, dueAt || null, pr]
  )
  if (!inserted) return { result: null, error: 'Insert failed' }
  await logActivity({
    userId: customerId,
    actorId: action.admin_id,
    kind: 'task_created',
    referenceId: inserted.id,
    referenceType: 'customer_tasks',
    summary: `Task created: ${t}`,
    metadata: { priority: pr, due_date: dueAt || null, via: 'agent' },
  }).catch(() => {})
  return { result: { taskId: inserted.id, customerId, title: t, priority: pr }, error: null }
}

export async function closeCustomerTask(action: AgentAction): Promise<ActionResult> {
  const { taskId, resolution } = action.payload as { taskId: string; resolution: string | null }
  if (!taskId) return { result: null, error: 'taskId required' }
  const task = await queryOne<{
    id: string
    user_id: string
    title: string
    status: string
    description: string | null
  }>(`SELECT id::text, user_id::text, title, status, description FROM customer_tasks WHERE id = $1::uuid LIMIT 1`, [
    taskId,
  ])
  if (!task) return { result: null, error: 'Task not found' }
  if (task.status === 'completed' || task.status === 'cancelled')
    return { result: null, error: `Task already ${task.status}` }
  const r = String(resolution || '')
    .trim()
    .slice(0, 500)
  const newDesc = r
    ? task.description
      ? `${task.description}\n\n--- Resolution ---\n${r}`
      : `Resolution: ${r}`
    : task.description
  await query(
    `UPDATE customer_tasks SET status = 'completed', completed_at = NOW(), completed_by = $1::uuid,
        description = $2, updated_at = NOW() WHERE id = $3::uuid`,
    [action.admin_id, newDesc, taskId]
  )
  await logActivity({
    userId: task.user_id,
    actorId: action.admin_id,
    kind: 'task_completed',
    referenceId: taskId,
    referenceType: 'customer_tasks',
    summary: `Task completed: ${task.title}`,
    metadata: r ? { resolution: r, via: 'agent' } : { via: 'agent' },
  }).catch(() => {})
  return { result: { taskId, customerId: task.user_id, title: task.title }, error: null }
}

export async function toggleMarketingOptOut(action: AgentAction): Promise<ActionResult> {
  const { customerId, optOut } = action.payload as { customerId: string; optOut: boolean }
  if (!customerId) return { result: null, error: 'customerId required' }
  const updated = await queryOne<{ id: string; email: string; marketing_opt_out: boolean }>(
    `UPDATE users SET marketing_opt_out = $1, updated_at = NOW() WHERE id = $2::uuid
     RETURNING id::text, email, marketing_opt_out`,
    [!!optOut, customerId]
  )
  if (!updated) return { result: null, error: 'Customer not found' }
  await logActivity({
    userId: customerId,
    actorId: action.admin_id,
    kind: optOut ? 'marketing_opted_out' : 'marketing_opted_in',
    summary: optOut ? 'Marketing emails disabled' : 'Marketing emails enabled',
    metadata: { via: 'agent' },
  }).catch(() => {})
  return { result: updated, error: null }
}

export async function createTagDefinition(action: AgentAction): Promise<ActionResult> {
  const { slug, color } = action.payload as { slug: string; color: string }
  if (!slug) return { result: null, error: 'slug required' }
  const safeColor = String(color || 'accent')
    .trim()
    .slice(0, 20)
  const maxOrder = await queryOne<{ sort_order: number }>(
    `SELECT sort_order FROM customer_tag_definitions ORDER BY sort_order DESC LIMIT 1`
  )
  const nextOrder = (maxOrder?.sort_order ?? 0) + 10
  try {
    await query(
      `INSERT INTO customer_tag_definitions (tag, color, sort_order, created_by)
      VALUES ($1, $2, $3, $4::uuid)`,
      [slug, safeColor, nextOrder, action.admin_id]
    )
  } catch (e: any) {
    if (e?.code === '23505') return { result: null, error: 'Tag already exists' }
    return { result: null, error: e?.message || 'Insert failed' }
  }
  return { result: { slug, color: safeColor, sort_order: nextOrder }, error: null }
}
