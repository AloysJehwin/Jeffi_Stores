# Customer Ops — Approve Route Cases

These switch-case bodies plug into `executeAction` in
`src/app/api/admin/agent/actions/[id]/approve/route.ts` (the file the lead must NOT modify directly,
but these are the bodies it would need to gain).

The acting admin is `action.admin_id` (the proposer; resolved from the JWT when the proposal was
created). For tasks/notes/tags, that admin id is the `admin_id` / `created_by` / `actor_id` we write
into the corresponding tables, mirroring the API routes the bodies are based on.

Imports the file would already need (some already there):

```ts
import { query, queryOne } from '@/lib/db'
import { logActivity } from '@/lib/activity'
import { recomputeHealth } from '@/lib/customer-health'
```

---

## case `'add_customer_note'`

Mirrors `POST /api/admin/customers/[id]/notes`.

```ts
case 'add_customer_note': {
  const { customerId, body } = action.payload as { customerId: string; body: string; isPrivate?: boolean }
  const text = String(body || '').trim()
  if (!customerId || !text) return { result: null, error: 'customerId and body required' }
  if (text.length > 2000) return { result: null, error: 'body too long (max 2000 chars)' }
  await query(
    `INSERT INTO customer_notes (user_id, body, admin_id) VALUES ($1::uuid, $2, $3::uuid)`,
    [customerId, text, action.admin_id]
  )
  await logActivity({
    userId: customerId,
    actorId: action.admin_id,
    kind: 'note_added',
    summary: text.length > 120 ? text.slice(0, 120) + '…' : text,
  }).catch(() => {})
  return { result: { customerId, length: text.length }, error: null }
}
```

---

## case `'add_customer_tag'`

Mirrors `POST /api/admin/customers/[id]/tags`. Tag is normalised on the proposal side; ON CONFLICT keeps
this idempotent.

```ts
case 'add_customer_tag': {
  const { customerId, tagSlug } = action.payload as { customerId: string; tagSlug: string; expiresAt?: string | null }
  const slug = String(tagSlug || '').trim().toLowerCase()
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
```

---

## case `'remove_customer_tag'`

Mirrors `DELETE /api/admin/customers/[id]/tags?tag=...`.

```ts
case 'remove_customer_tag': {
  const { customerId, tagSlug } = action.payload as { customerId: string; tagSlug: string }
  const slug = String(tagSlug || '').trim().toLowerCase()
  if (!customerId || !slug) return { result: null, error: 'customerId and tagSlug required' }
  const r = await query(
    `DELETE FROM customer_tags WHERE user_id = $1::uuid AND tag = $2`,
    [customerId, slug]
  )
  await logActivity({
    userId: customerId,
    actorId: action.admin_id,
    kind: 'tag_removed',
    summary: `Tag "${slug}" removed`,
    metadata: { tag: slug, via: 'agent' },
  }).catch(() => {})
  return { result: { customerId, tag: slug, removed: r.rowCount ?? 0 }, error: null }
}
```

---

## case `'create_customer_task'`

Mirrors `POST /api/admin/customers/[id]/tasks`. `assignedToAdminId` defaults to the acting admin.

```ts
case 'create_customer_task': {
  const { customerId, title, dueAt, assignedToAdminId, priority } =
    action.payload as { customerId: string; title: string; dueAt: string | null; assignedToAdminId: string | null; priority: string }
  const t = String(title || '').trim().slice(0, 255)
  if (!customerId || !t) return { result: null, error: 'customerId and title required' }
  const validPriorities = ['low', 'medium', 'high', 'urgent']
  const pr = validPriorities.includes(priority) ? priority : 'medium'
  const assignee = assignedToAdminId || action.admin_id
  const inserted = await queryOne<{ id: string }>(
    `INSERT INTO customer_tasks (user_id, created_by, assigned_to, title, due_date, priority)
     VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5, $6)
     RETURNING id::text`,
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
```

---

## case `'close_customer_task'`

Mirrors `PATCH /api/admin/customers/[id]/tasks/[taskId]` with `status: 'completed'`. The optional
`resolution` is appended to the task description so it survives in `customer_tasks`. The customerId
is read from the row to be safe (the proposal also stored it on the payload, but we re-verify).

```ts
case 'close_customer_task': {
  const { taskId, resolution } = action.payload as { taskId: string; customerId?: string; resolution: string | null }
  if (!taskId) return { result: null, error: 'taskId required' }
  const task = await queryOne<{ id: string; user_id: string; title: string; status: string; description: string | null }>(
    `SELECT id::text, user_id::text, title, status, description FROM customer_tasks WHERE id = $1::uuid LIMIT 1`,
    [taskId]
  )
  if (!task) return { result: null, error: 'Task not found' }
  if (task.status === 'completed' || task.status === 'cancelled') {
    return { result: null, error: `Task already ${task.status}` }
  }
  const r = String(resolution || '').trim().slice(0, 500)
  const newDesc = r
    ? (task.description ? `${task.description}\n\n--- Resolution ---\n${r}` : `Resolution: ${r}`)
    : task.description
  await query(
    `UPDATE customer_tasks
       SET status = 'completed', completed_at = NOW(), completed_by = $1::uuid,
           description = $2, updated_at = NOW()
     WHERE id = $3::uuid`,
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
```

---

## case `'toggle_marketing_opt_out'`

Direct UPDATE on `users.marketing_opt_out` (no dedicated API route exists; this is the canonical
column used by the campaign senders, see `approve/route.ts` recipient queries).

```ts
case 'toggle_marketing_opt_out': {
  const { customerId, optOut } = action.payload as { customerId: string; optOut: boolean }
  if (!customerId) return { result: null, error: 'customerId required' }
  const updated = await queryOne<{ id: string; email: string; marketing_opt_out: boolean }>(
    `UPDATE users SET marketing_opt_out = $1, updated_at = NOW()
       WHERE id = $2::uuid
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
```

If `customer_health` integration is desired post-toggle, append:

```ts
recomputeHealth(customerId).catch(() => {})
```

---

## case `'create_tag_definition'`

Mirrors `POST /api/admin/customer-tag-definitions`. Note the schema has only `tag`, `color`, `sort_order`
(no `label` / `description` columns); the proposal payload may include them but we only persist what
the schema supports. `label` and `description` are dropped on insert but kept in the action history
via `payload` for audit.

```ts
case 'create_tag_definition': {
  const { slug, color } = action.payload as { slug: string; label?: string; color: string; description?: string | null }
  if (!slug) return { result: null, error: 'slug required' }
  const safeColor = String(color || 'accent').trim().slice(0, 20)
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
```

---

## Tool registration note (for the lead)

`CUSTOMER_OPS_TOOLS` from `src/lib/admin-agent/tools/customer-ops.ts` should be appended to the
exported `TOOLS` array in `src/lib/admin-agent/tools.ts` — but per the constraint, that change is
the lead's job (single merge step alongside the other domain bundles), not this subagent's.
