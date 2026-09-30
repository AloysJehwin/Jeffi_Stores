import { queryMany, queryOne } from '@/lib/db'
import type { ToolDef } from '../tools'
import { ok } from '../tool-envelope'

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n))
}

interface CustomerLite {
  id: string
  email: string
  name: string
}

async function loadCustomerLite(userId: string): Promise<CustomerLite> {
  const u = await queryOne<{ id: string; email: string; first_name: string | null; last_name: string | null }>(
    `SELECT id::text, email, first_name, last_name FROM users WHERE id = $1::uuid LIMIT 1`,
    [userId]
  )
  if (!u) throw new Error('Customer not found')
  const name = `${u.first_name || ''} ${u.last_name || ''}`.trim() || u.email
  return { id: u.id, email: u.email, name }
}

export const CUSTOMER_OPS_TOOLS: ToolDef[] = [
  {
    name: 'get_customer_notes',
    description: 'Admin-only notes on a customer, newest first. Includes who wrote each note.',
    inputSchema: {
      type: 'object',
      properties: {
        customerId: { type: 'string', description: 'Customer (user) UUID.' },
        limit: { type: 'integer', default: 20, minimum: 1, maximum: 100 },
      },
      required: ['customerId'],
    },
    mutating: false,
    handler: async ({ customerId, limit }) => {
      const lim = clamp(typeof limit === 'number' ? limit : 20, 1, 100)
      const rows = await queryMany(
        `SELECT n.id::text, n.body, n.created_at,
                COALESCE(NULLIF(TRIM(au.first_name || ' ' || COALESCE(au.last_name, '')), ''), au.email) AS admin_username,
                COALESCE(NULLIF(TRIM(au.first_name || ' ' || COALESCE(au.last_name, '')), ''), au.email) AS admin_name
           FROM customer_notes n
           LEFT JOIN admins a ON a.id = n.admin_id
           LEFT JOIN users  au ON au.id = a.user_id
          WHERE n.user_id = $1::uuid
          ORDER BY n.created_at DESC LIMIT $2`,
        [String(customerId), lim]
      )
      return { notes: rows, count: rows.length, truncated: rows.length === lim }
    },
  },
  {
    name: 'get_customer_tasks',
    description: 'Tasks for a customer. status filter: "open" (pending+in_progress), "completed", or omit for all.',
    inputSchema: {
      type: 'object',
      properties: {
        customerId: { type: 'string' },
        status: { type: 'string', description: 'open | completed' },
        limit: { type: 'integer', default: 25, minimum: 1, maximum: 100 },
      },
      required: ['customerId'],
    },
    mutating: false,
    handler: async ({ customerId, status, limit }) => {
      const lim = clamp(typeof limit === 'number' ? limit : 25, 1, 100)
      const wheres = ['ct.user_id = $1::uuid']
      const vals: unknown[] = [String(customerId)]
      if (status === 'open') wheres.push(`ct.status IN ('pending','in_progress')`)
      else if (status === 'completed') wheres.push(`ct.status = 'completed'`)
      vals.push(lim)
      const rows = await queryMany(
        `SELECT ct.id::text, ct.title, ct.description, ct.priority, ct.status,
                ct.due_date, ct.completed_at, ct.created_at,
                COALESCE(NULLIF(TRIM(aau.first_name || ' ' || COALESCE(aau.last_name, '')), ''), aau.email) AS assigned_to_username,
                ct.assigned_to::text
           FROM customer_tasks ct
           LEFT JOIN admins aa ON aa.id = ct.assigned_to
           LEFT JOIN users aau ON aau.id = aa.user_id
          WHERE ${wheres.join(' AND ')}
          ORDER BY
            CASE ct.status WHEN 'pending' THEN 0 WHEN 'in_progress' THEN 1 ELSE 2 END,
            CASE ct.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,
            ct.due_date NULLS LAST, ct.created_at DESC
          LIMIT $${vals.length}`,
        vals
      )
      return { tasks: rows, count: rows.length, truncated: rows.length === lim }
    },
  },
  {
    name: 'get_customer_tags',
    description: 'Tags currently applied to a customer.',
    inputSchema: {
      type: 'object',
      properties: { customerId: { type: 'string' } },
      required: ['customerId'],
    },
    mutating: false,
    handler: async ({ customerId }) => {
      const rows = await queryMany(
        `SELECT ct.id::text, ct.tag, ct.created_at,
                d.color, d.sort_order
           FROM customer_tags ct
           LEFT JOIN customer_tag_definitions d ON d.tag = ct.tag
          WHERE ct.user_id = $1::uuid
          ORDER BY d.sort_order NULLS LAST, ct.tag`,
        [String(customerId)]
      )
      return { tags: rows, count: rows.length }
    },
  },
  {
    name: 'get_customer_health',
    description: 'Customer health score breakdown (recency/frequency/monetary/engagement/satisfaction) and churn risk.',
    inputSchema: {
      type: 'object',
      properties: { customerId: { type: 'string' } },
      required: ['customerId'],
    },
    mutating: false,
    handler: async ({ customerId }) => {
      const row = await queryOne(
        `SELECT user_id::text, score, recency_score, frequency_score, monetary_score,
                engagement_score, satisfaction_score, churn_risk,
                trend_delta_7d, trend_delta_30d, last_computed_at
           FROM customer_health WHERE user_id = $1::uuid LIMIT 1`,
        [String(customerId)]
      )
      if (!row) return { health: null, note: 'Health not yet computed for this customer.' }
      return { health: row }
    },
  },
  {
    name: 'list_tag_definitions',
    description: 'All tag types admins can apply to customers (slug, color, sort order).',
    inputSchema: { type: 'object', properties: {} },
    mutating: false,
    handler: async () => {
      const rows = await queryMany(
        `SELECT id::text, tag, color, sort_order, created_at
           FROM customer_tag_definitions ORDER BY sort_order ASC, tag ASC`
      )
      return { definitions: rows, count: rows.length }
    },
  },
  {
    name: 'list_customers_by_tag',
    description: 'Customers who currently have a given tag.',
    inputSchema: {
      type: 'object',
      properties: {
        tagSlug: { type: 'string', description: 'Lowercase tag slug, e.g. "vip" or "at-risk".' },
        limit: { type: 'integer', default: 25, minimum: 1, maximum: 200 },
      },
      required: ['tagSlug'],
    },
    mutating: false,
    handler: async ({ tagSlug, limit }) => {
      const lim = clamp(typeof limit === 'number' ? limit : 25, 1, 200)
      const slug = String(tagSlug || '')
        .trim()
        .toLowerCase()
      if (!slug) throw new Error('tagSlug is required')
      const rows = await queryMany(
        `SELECT u.id::text, u.email,
                COALESCE(NULLIF(TRIM(u.first_name || ' ' || COALESCE(u.last_name, '')), ''), u.email) AS name,
                u.phone, ct.created_at AS tagged_at,
                COALESCE((SELECT COUNT(*) FROM orders o WHERE o.user_id = u.id AND o.payment_status = 'paid'), 0)::int AS paid_orders
           FROM customer_tags ct
           JOIN users u ON u.id = ct.user_id
          WHERE ct.tag = $1
          ORDER BY ct.created_at DESC LIMIT $2`,
        [slug, lim]
      )
      return ok({
        summary:
          rows.length === 0
            ? `No customers tagged "${slug}".`
            : `Found ${rows.length}${rows.length === lim ? '+' : ''} customer${rows.length === 1 ? '' : 's'} tagged "${slug}".`,
        count: rows.length,
        data: { tag: slug, customers: rows, truncated: rows.length === lim },
        displayHints: { primaryField: 'name', itemNoun: 'customer' },
      })
    },
  },
  {
    name: 'list_open_tasks',
    description: 'All open customer tasks across the store, optionally filtered by assignee admin id.',
    inputSchema: {
      type: 'object',
      properties: {
        adminId: { type: 'string', description: 'Optional. Admin UUID to filter assigned_to.' },
        limit: { type: 'integer', default: 25, minimum: 1, maximum: 200 },
      },
    },
    mutating: false,
    handler: async ({ adminId, limit }) => {
      const lim = clamp(typeof limit === 'number' ? limit : 25, 1, 200)
      const wheres = [`ct.status IN ('pending','in_progress')`]
      const vals: unknown[] = []
      if (adminId) {
        vals.push(String(adminId))
        wheres.push(`ct.assigned_to = $${vals.length}::uuid`)
      }
      vals.push(lim)
      const rows = await queryMany(
        `SELECT ct.id::text, ct.title, ct.priority, ct.status, ct.due_date, ct.created_at,
                ct.user_id::text AS customer_id,
                u.email AS customer_email,
                COALESCE(NULLIF(TRIM(u.first_name || ' ' || COALESCE(u.last_name,'')), ''), u.email) AS customer_name,
                COALESCE(NULLIF(TRIM(aau.first_name || ' ' || COALESCE(aau.last_name, '')), ''), aau.email) AS assigned_to_username
           FROM customer_tasks ct
           LEFT JOIN users u ON u.id = ct.user_id
           LEFT JOIN admins aa ON aa.id = ct.assigned_to
           LEFT JOIN users aau ON aau.id = aa.user_id
          WHERE ${wheres.join(' AND ')}
          ORDER BY
            CASE ct.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,
            ct.due_date NULLS LAST, ct.created_at DESC
          LIMIT $${vals.length}`,
        vals
      )
      return { tasks: rows, count: rows.length, truncated: rows.length === lim }
    },
  },
  {
    name: 'propose_add_customer_note',
    description: 'Propose adding an admin note to a customer. Admin must approve before insert.',
    inputSchema: {
      type: 'object',
      properties: {
        customerId: { type: 'string' },
        body: { type: 'string', description: 'Note text. Max 2000 chars.' },
        isPrivate: {
          type: 'string',
          description: 'Reserved privacy flag. Pass "true" to mark; ignored if column missing.',
        },
      },
      required: ['customerId', 'body'],
    },
    mutating: true,
    handler: async ({ customerId, body, isPrivate }) => {
      const text = String(body || '').trim()
      if (!text) throw new Error('body is required')
      if (text.length > 2000) throw new Error('body too long (max 2000 chars)')
      const c = await loadCustomerLite(String(customerId))
      const priv = String(isPrivate || '').toLowerCase() === 'true'
      const preview = text.length > 100 ? text.slice(0, 100) + '…' : text
      return {
        proposed: true,
        kind: 'add_customer_note',
        payload: { customerId: c.id, body: text, isPrivate: priv },
        confirmation: `Add a note to ${c.name} (${c.email}): "${preview}"?`,
        ui_blocks: [
          { type: 'heading', value: 'New customer note', level: 3 },
          {
            type: 'kv_pairs',
            pairs: [
              { key: 'Customer', value: c.name },
              { key: 'Email', value: c.email },
              { key: 'Length', value: `${text.length} chars${priv ? ' (private)' : ''}` },
            ],
          },
          { type: 'code_block', content: text },
        ],
      }
    },
  },
  {
    name: 'propose_add_customer_tag',
    description: 'Propose tagging a customer. Skips if the tag is already applied.',
    inputSchema: {
      type: 'object',
      properties: {
        customerId: { type: 'string' },
        tagSlug: { type: 'string', description: 'Lowercase slug. Will be lower-cased and trimmed.' },
        expiresAt: { type: 'string', description: 'Optional ISO timestamp. Reserved; depends on schema support.' },
      },
      required: ['customerId', 'tagSlug'],
    },
    mutating: true,
    handler: async ({ customerId, tagSlug, expiresAt }) => {
      const slug = String(tagSlug || '')
        .trim()
        .toLowerCase()
      if (!slug) throw new Error('tagSlug is required')
      const c = await loadCustomerLite(String(customerId))
      const existing = await queryOne(`SELECT 1 FROM customer_tags WHERE user_id = $1::uuid AND tag = $2 LIMIT 1`, [
        c.id,
        slug,
      ])
      const expIso = expiresAt ? String(expiresAt) : null
      if (existing) {
        return {
          proposed: false,
          info: `Tag "${slug}" is already on ${c.name}.`,
          ui_blocks: [
            { type: 'callout', tone: 'info', message: `${c.name} already has the "${slug}" tag, nothing to do.` },
          ],
        }
      }
      return {
        proposed: true,
        kind: 'add_customer_tag',
        payload: { customerId: c.id, tagSlug: slug, expiresAt: expIso },
        confirmation: `Add tag "${slug}" to ${c.name} (${c.email})?`,
        ui_blocks: [
          { type: 'heading', value: 'Add customer tag', level: 3 },
          {
            type: 'kv_pairs',
            pairs: [
              { key: 'Customer', value: c.name },
              { key: 'Email', value: c.email },
              { key: 'Tag', value: slug },
              ...(expIso ? [{ key: 'Expires at', value: expIso }] : []),
            ],
          },
        ],
      }
    },
  },
  {
    name: 'propose_remove_customer_tag',
    description: 'Propose removing a tag from a customer.',
    inputSchema: {
      type: 'object',
      properties: {
        customerId: { type: 'string' },
        tagSlug: { type: 'string' },
      },
      required: ['customerId', 'tagSlug'],
    },
    mutating: true,
    handler: async ({ customerId, tagSlug }) => {
      const slug = String(tagSlug || '')
        .trim()
        .toLowerCase()
      if (!slug) throw new Error('tagSlug is required')
      const c = await loadCustomerLite(String(customerId))
      const existing = await queryOne(`SELECT 1 FROM customer_tags WHERE user_id = $1::uuid AND tag = $2 LIMIT 1`, [
        c.id,
        slug,
      ])
      if (!existing) {
        return {
          proposed: false,
          info: `Tag "${slug}" is not on ${c.name}.`,
          ui_blocks: [
            { type: 'callout', tone: 'info', message: `${c.name} does not have the "${slug}" tag, nothing to remove.` },
          ],
        }
      }
      return {
        proposed: true,
        kind: 'remove_customer_tag',
        payload: { customerId: c.id, tagSlug: slug },
        confirmation: `Remove tag "${slug}" from ${c.name} (${c.email})?`,
        ui_blocks: [
          { type: 'heading', value: 'Remove customer tag', level: 3 },
          {
            type: 'kv_pairs',
            pairs: [
              { key: 'Customer', value: c.name },
              { key: 'Email', value: c.email },
              { key: 'Tag to remove', value: slug },
            ],
          },
        ],
      }
    },
  },
  {
    name: 'propose_create_customer_task',
    description: 'Propose creating a follow-up task on a customer.',
    inputSchema: {
      type: 'object',
      properties: {
        customerId: { type: 'string' },
        title: { type: 'string', description: 'Short title (max 255 chars).' },
        dueAt: { type: 'string', description: 'Optional ISO date or timestamp.' },
        assignedToAdminId: { type: 'string', description: 'Optional admin UUID. Defaults to acting admin on execute.' },
        priority: { type: 'string', description: 'low | medium | high | urgent (default medium).' },
      },
      required: ['customerId', 'title'],
    },
    mutating: true,
    handler: async ({ customerId, title, dueAt, assignedToAdminId, priority }) => {
      const t = String(title || '')
        .trim()
        .slice(0, 255)
      if (!t) throw new Error('title is required')
      const c = await loadCustomerLite(String(customerId))
      const validPriorities = ['low', 'medium', 'high', 'urgent']
      const pr = validPriorities.includes(String(priority)) ? String(priority) : 'medium'
      const due = dueAt ? String(dueAt) : null
      const assignee = assignedToAdminId ? String(assignedToAdminId) : null
      let assigneeLabel = 'Self (acting admin)'
      if (assignee) {
        const a = await queryOne<{ label: string }>(
          `SELECT COALESCE(NULLIF(TRIM(u.first_name || ' ' || COALESCE(u.last_name, '')), ''), u.email) AS label
             FROM admins a JOIN users u ON u.id = a.user_id
            WHERE a.id = $1::uuid LIMIT 1`,
          [assignee]
        )
        assigneeLabel = a?.label ? `@${a.label}` : assignee
      }
      return {
        proposed: true,
        kind: 'create_customer_task',
        payload: {
          customerId: c.id,
          title: t,
          dueAt: due,
          assignedToAdminId: assignee,
          priority: pr,
        },
        confirmation: `Create ${pr} task "${t}" on ${c.name} (${c.email})${due ? `, due ${due}` : ''}?`,
        ui_blocks: [
          { type: 'heading', value: 'New customer task', level: 3 },
          {
            type: 'kv_pairs',
            pairs: [
              { key: 'Customer', value: c.name },
              { key: 'Email', value: c.email },
              { key: 'Priority', value: pr },
              { key: 'Assignee', value: assigneeLabel },
              ...(due ? [{ key: 'Due', value: due }] : []),
            ],
          },
          { type: 'text', value: t, weight: 'bold' },
        ],
      }
    },
  },
  {
    name: 'propose_close_customer_task',
    description:
      'Propose marking a customer task as completed (with an optional resolution note appended to description).',
    inputSchema: {
      type: 'object',
      properties: {
        taskId: { type: 'string' },
        resolution: { type: 'string', description: 'Optional resolution note (max 500 chars).' },
      },
      required: ['taskId'],
    },
    mutating: true,
    handler: async ({ taskId, resolution }) => {
      const tid = String(taskId || '').trim()
      if (!tid) throw new Error('taskId is required')
      const r = String(resolution || '')
        .trim()
        .slice(0, 500)
      const task = await queryOne<{
        id: string
        title: string
        status: string
        user_id: string
        customer_email: string
        customer_name: string
      }>(
        `SELECT ct.id::text, ct.title, ct.status, ct.user_id::text,
                u.email AS customer_email,
                COALESCE(NULLIF(TRIM(u.first_name || ' ' || COALESCE(u.last_name, '')), ''), u.email) AS customer_name
           FROM customer_tasks ct
           LEFT JOIN users u ON u.id = ct.user_id
          WHERE ct.id = $1::uuid LIMIT 1`,
        [tid]
      )
      if (!task) throw new Error('Task not found')
      if (task.status === 'completed' || task.status === 'cancelled') {
        return {
          proposed: false,
          info: `Task "${task.title}" is already ${task.status}.`,
          ui_blocks: [{ type: 'callout', tone: 'info', message: `Task already ${task.status}.` }],
        }
      }
      return {
        proposed: true,
        kind: 'close_customer_task',
        payload: { taskId: task.id, customerId: task.user_id, resolution: r || null },
        confirmation: `Close task "${task.title}" for ${task.customer_name}${r ? ` with resolution: "${r}"` : ''}?`,
        ui_blocks: [
          { type: 'heading', value: 'Close customer task', level: 3 },
          {
            type: 'kv_pairs',
            pairs: [
              { key: 'Task', value: task.title },
              { key: 'Customer', value: task.customer_name },
              { key: 'Email', value: task.customer_email },
              ...(r ? [{ key: 'Resolution', value: r }] : []),
            ],
          },
        ],
      }
    },
  },
  {
    name: 'propose_toggle_marketing_opt_out',
    description:
      "Propose flipping a customer's marketing opt-out flag. PRIVACY-SENSITIVE: opting OUT stops them receiving marketing immediately.",
    inputSchema: {
      type: 'object',
      properties: {
        customerId: { type: 'string' },
        optOut: { type: 'string', description: '"true" to opt OUT (stop marketing), "false" to opt IN.' },
      },
      required: ['customerId', 'optOut'],
    },
    mutating: true,
    handler: async ({ customerId, optOut }) => {
      const target = String(optOut).toLowerCase() === 'true'
      const c = await loadCustomerLite(String(customerId))
      const cur = await queryOne<{ marketing_opt_out: boolean }>(
        `SELECT marketing_opt_out FROM users WHERE id = $1::uuid LIMIT 1`,
        [c.id]
      )
      const wasOptedOut = !!cur?.marketing_opt_out
      if (wasOptedOut === target) {
        return {
          proposed: false,
          info: `${c.name} is already opted ${target ? 'OUT of' : 'IN to'} marketing.`,
          ui_blocks: [{ type: 'callout', tone: 'info', message: `No change, already opted ${target ? 'out' : 'in'}.` }],
        }
      }
      const ui_blocks: unknown[] = [
        { type: 'heading', value: target ? 'Opt customer OUT of marketing' : 'Opt customer IN to marketing', level: 3 },
        {
          type: 'kv_pairs',
          pairs: [
            { key: 'Customer', value: c.name },
            { key: 'Email', value: c.email },
            { key: 'Current state', value: wasOptedOut ? 'Opted out' : 'Opted in' },
            { key: 'New state', value: target ? 'Opted out' : 'Opted in' },
          ],
        },
      ]
      if (target) {
        ui_blocks.push({
          type: 'callout',
          tone: 'warn',
          title: 'Privacy-sensitive change',
          message: `${c.email} is currently receiving marketing emails. Opting them out will stop all marketing immediately. Confirm only if the customer asked for this.`,
        })
      } else {
        ui_blocks.push({
          type: 'callout',
          tone: 'warn',
          title: 'Re-enabling marketing',
          message: `Make sure the customer explicitly consented before opting them back in.`,
        })
      }
      return {
        proposed: true,
        kind: 'toggle_marketing_opt_out',
        payload: { customerId: c.id, optOut: target },
        confirmation: `${target ? 'Opt OUT' : 'Opt IN'} ${c.name} (${c.email}) ${target ? 'of' : 'to'} marketing emails?`,
        ui_blocks,
      }
    },
  },
  {
    name: 'propose_create_tag_definition',
    description:
      'Propose creating a new tag type that admins can apply to customers. Curates the vocabulary and does NOT tag any customer.',
    inputSchema: {
      type: 'object',
      properties: {
        slug: { type: 'string', description: 'Lowercase slug (will be sanitized). Max 60 chars.' },
        label: { type: 'string', description: 'Display label (passed through; current schema only stores slug).' },
        color: { type: 'string', description: 'Color token, e.g. "blue", "purple", "accent". Default "accent".' },
        description: {
          type: 'string',
          description: 'Optional description (held in payload only; schema does not store it yet).',
        },
      },
      required: ['slug', 'label'],
    },
    mutating: true,
    handler: async ({ slug, label, color, description }) => {
      const cleaned = String(slug || '')
        .trim()
        .toLowerCase()
        .replace(/\s+/g, '-')
        .slice(0, 60)
      if (!cleaned) throw new Error('slug is required')
      if (!/^[a-z0-9][a-z0-9-]*$/.test(cleaned)) {
        throw new Error('slug must be lowercase alphanumerics + hyphens')
      }
      const lbl =
        String(label || '')
          .trim()
          .slice(0, 80) || cleaned
      const col = String(color || 'accent')
        .trim()
        .slice(0, 20)
      const desc = description ? String(description).trim().slice(0, 280) : null
      const existing = await queryOne(`SELECT 1 FROM customer_tag_definitions WHERE tag = $1 LIMIT 1`, [cleaned])
      if (existing) {
        return {
          proposed: false,
          info: `Tag definition "${cleaned}" already exists.`,
          ui_blocks: [{ type: 'callout', tone: 'info', message: `"${cleaned}" is already a tag, nothing to create.` }],
        }
      }
      return {
        proposed: true,
        kind: 'create_tag_definition',
        payload: { slug: cleaned, label: lbl, color: col, description: desc },
        confirmation: `Create tag definition "${cleaned}" (${lbl}, color=${col})?`,
        ui_blocks: [
          { type: 'heading', value: 'New tag definition', level: 3 },
          {
            type: 'kv_pairs',
            pairs: [
              { key: 'Slug', value: cleaned },
              { key: 'Label', value: lbl },
              { key: 'Color', value: col },
              ...(desc ? [{ key: 'Description', value: desc }] : []),
            ],
          },
        ],
      }
    },
  },
]
