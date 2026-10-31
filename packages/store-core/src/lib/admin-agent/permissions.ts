import { hasScope, isPlatformOwner } from '@/lib/auth/scopes'

export interface AgentActor {
  adminId: string
  role: string
  scopes: string[]
}

// Scope each tool needs: the one the matching admin API route checks. 'a+b' needs both; 'owner' is
// administrator / super admin only (tools with no area of their own: raw SQL, repo, generic API).
export const TOOL_SCOPES: Record<string, string | 'owner'> = {
  // Catalogue
  search_products: 'products:read',
  get_product: 'products:read',
  get_product_variants: 'products:read',
  find_similar_products: 'products:read',
  get_recent_products: 'products:read',
  list_featured_products: 'products:read',
  get_product_full: 'products:read',
  propose_create_product: 'products:write',
  propose_update_product: 'products:write',
  propose_set_product_featured: 'products:write',
  list_brands: 'brands:read',
  get_brand: 'brands:read',
  propose_create_brand: 'brands:write',
  list_categories: 'categories:read',
  get_category: 'categories:read',
  propose_create_category: 'categories:write',
  get_low_stock_products: 'inventory:read',
  list_inventory_low: 'inventory:read',
  propose_adjust_inventory: 'inventory:write',

  // Customers (tasks routes are gated on customers:*)
  search_customers: 'customers:read',
  get_recent_customers: 'customers:read',
  get_customer: 'customers:read',
  get_customer_notes: 'customers:read',
  get_customer_tasks: 'customers:read',
  get_customer_tags: 'customers:read',
  get_customer_health: 'customers:read',
  list_tag_definitions: 'customers:read',
  list_customers_by_tag: 'customers:read',
  list_open_tasks: 'customers:read',
  propose_add_customer_note: 'customers:write',
  propose_add_customer_tag: 'customers:write',
  propose_remove_customer_tag: 'customers:write',
  propose_create_customer_task: 'customers:write',
  propose_close_customer_task: 'customers:write',
  propose_toggle_marketing_opt_out: 'customers:write',
  propose_create_tag_definition: 'customers:write',

  // Orders, payments, refunds
  get_recent_orders: 'orders:read',
  get_order: 'orders:read',
  find_customer_orders: 'orders:read',
  get_order_refund_options: 'orders:read',
  mark_order_shipped: 'orders:write',
  propose_update_order_status: 'orders:write',
  propose_set_payment_status: 'orders:write',
  propose_mark_invoice_paid: 'orders:write',
  propose_refund_order: 'orders:write',
  propose_cancel_order: 'orders:write',
  propose_order_delay_email: 'orders:write+mailer:write',

  // Quotations, invoices, cash sales
  list_quotations: 'quotations:read',
  get_quotation: 'quotations:read',
  match_quotation_items: 'quotations:read',
  extract_quotation_lines_from_attachment: 'quotations:read',
  propose_create_quotation: 'quotations:write',
  propose_send_quotation_email: 'quotations:write',
  list_invoices: 'invoices:read',
  get_invoice: 'invoices:read',
  list_cash_sales: 'invoices:read',
  get_cash_sale: 'invoices:read',

  // Email, campaigns, coupons (campaign routes are gated on mailer:*)
  get_campaign_stats: 'mailer:read',
  list_campaigns: 'mailer:read',
  get_campaign: 'mailer:read',
  list_mailer_templates: 'mailer:read',
  estimate_email_audience: 'mailer:read',
  send_test_email: 'mailer:write',
  toggle_campaign_enabled: 'mailer:write',
  propose_update_campaign_template: 'mailer:write',
  propose_send_mailer_broadcast: 'mailer:write',
  propose_product_announcement_email: 'mailer:write',
  list_coupons: 'coupons:read',
  get_coupon: 'coupons:read',
  propose_create_coupon: 'coupons:write',
  propose_generate_personalized_coupon: 'coupons:write',

  // Shipping, finance, GST
  list_pending_pickups: 'delhivery:read',
  list_recent_pickups: 'delhivery:read',
  propose_create_pickup_request: 'delhivery:write',
  propose_sync_delhivery_statuses: 'delhivery:write',
  list_payables: 'financial:read',
  list_receivables: 'financial:read',
  get_cashflow_summary: 'financial:read',
  get_pl_summary: 'financial:read',
  list_recent_transactions: 'financial:read',
  propose_pay_payable: 'financial:write',
  get_gst_summary: 'gst:read',
  // The GSTR-1 export route only checks gst:read.
  propose_export_gstr1: 'gst:read',

  // Google Ads
  ads_overview: 'google_ads:read',
  ads_top_campaigns: 'google_ads:read',
  ads_wasted_search_terms: 'google_ads:read',
  ads_products_without_stock: 'google_ads:read',
  ads_true_roas: 'google_ads:read',
  propose_pause_campaign: 'google_ads_campaigns:write',
  propose_budget_change: 'google_ads_campaigns:write',
  propose_add_negative_keyword: 'google_ads_campaigns:write',

  // Agent itself
  list_admin_tools: 'agent:read',
  // Each list's own read scope is checked in the tool.
  get_page_rows: 'agent:read',
  get_change_log: 'agent:read',
  read_attachment: 'agent:read',
  render_ui: 'agent:read',

  // No area of their own: they reach any table, file or route
  run_sql_readonly: 'owner',
  describe_schema: 'owner',
  list_repo_files: 'owner',
  read_repo_file: 'owner',
  list_admin_api_routes: 'owner',
  call_admin_api: 'owner',
}

// Scope each approvable action kind needs: the one its executing endpoint checks.
export const ACTION_SCOPES: Record<string, string | 'owner'> = {
  update_order_status: 'orders:write',
  set_payment_status: 'orders:write',
  mark_order_shipped: 'orders:write',
  mark_invoice_paid: 'orders:write',
  refund_order: 'orders:write',
  cancel_order: 'orders:write',
  send_order_delay_email: 'orders:write+mailer:write',
  send_test_email: 'mailer:write',
  toggle_campaign_enabled: 'mailer:write',
  update_campaign_template: 'mailer:write',
  send_mailer_broadcast: 'mailer:write',
  send_product_announcement_email: 'mailer:write',
  create_coupon: 'coupons:write',
  generate_personalized_coupon: 'coupons:write',
  create_product: 'products:write',
  update_product: 'products:write',
  set_product_featured: 'products:write',
  adjust_inventory: 'inventory:write',
  create_brand: 'brands:write',
  create_category: 'categories:write',
  add_customer_note: 'customers:write',
  add_customer_tag: 'customers:write',
  remove_customer_tag: 'customers:write',
  create_customer_task: 'customers:write',
  close_customer_task: 'customers:write',
  toggle_marketing_opt_out: 'customers:write',
  create_tag_definition: 'customers:write',
  create_quotation: 'quotations:write',
  send_quotation_email: 'quotations:write',
  create_pickup_request: 'delhivery:write',
  sync_delhivery_statuses: 'delhivery:write',
  pay_payable: 'financial:write',
  export_gstr1: 'gst:read',
  google_ads_action: 'google_ads_campaigns:write',
  call_admin_api: 'owner',
}

// Kinds that write an order's status / payment status through PATCH /api/orders/[id].
const STATUS_KINDS = new Set(['update_order_status', 'set_payment_status', 'cancel_order'])

const OWNER_ONLY = 'administrator or super admin'

function satisfies(required: string, actor: AgentActor): boolean {
  if (required === 'owner') return isPlatformOwner(actor.role)
  return required.split('+').every(s => hasScope(actor.role, actor.scopes || [], s))
}

const AREA_LABELS: Record<string, string> = {
  orders: 'Orders',
  customers: 'Customers',
  products: 'Products',
  inventory: 'Inventory',
  brands: 'Brands',
  categories: 'Categories',
  coupons: 'Coupons',
  mailer: 'Email & campaigns',
  quotations: 'Quotations',
  invoices: 'Invoices',
  delhivery: 'Shipping (Delhivery)',
  financial: 'Finance',
  gst: 'GST',
  google_ads: 'Google Ads',
  google_ads_campaigns: 'Google Ads campaigns',
  agent: 'Agent',
}

const areaOf = (scope: string) => scope.split(':')[0]
const areaLabel = (scope: string) => AREA_LABELS[areaOf(scope)] ?? areaOf(scope).replace(/_/g, ' ')

function requirementLabel(required: string): string {
  if (required === 'owner') return `an ${OWNER_ONLY}`
  return required
    .split('+')
    .map(s => `${areaLabel(s)} (${s.endsWith(':write') ? 'write' : 'read'})`)
    .join(' and ')
}

export function toolAllowed(toolName: string, actor: AgentActor): boolean {
  const required = TOOL_SCOPES[toolName]
  return required !== undefined && satisfies(required, actor)
}

/** null when the actor may approve this action, else the reason to show them. */
export function actionDenial(kind: string, payload: any, actor: AgentActor): string | null {
  const required = ACTION_SCOPES[kind]
  if (required === undefined) return `The agent can't run "${kind}" actions.`
  if (!satisfies(required, actor)) {
    return required === 'owner'
      ? `Only an ${OWNER_ONLY} can approve this action.`
      : `Your role doesn't have the ${requirementLabel(required)} permission needed to approve this.`
  }
  if (STATUS_KINDS.has(kind)) {
    const override = payload?.override === true
    if (override) {
      if (!isPlatformOwner(actor.role)) {
        return `Only an ${OWNER_ONLY} can override the order and payment status rules.`
      }
      const reason = typeof payload?.overrideReason === 'string' ? payload.overrideReason.trim() : ''
      if (reason.length < 10 || reason.length > 500) return 'An override needs a reason of 10–500 characters.'
    } else if (payload?.paymentStatus === 'refunded') {
      return 'Marking an order refunded needs a real refund. Ask the agent to propose a refund instead.'
    }
  }
  return null
}

const ROLE_LABELS: Record<string, string> = {
  administrator: 'Administrator (platform operator)',
  super_admin: 'Super admin (store owner)',
  admin: 'Admin',
  moderator: 'Moderator',
}

/** Short markdown for the system prompt: what this admin may read, change and override. */
export function describeActorCapabilities(actor: AgentActor): string {
  const areas = new Map<string, { read: boolean; write: boolean }>()
  for (const required of Object.values(TOOL_SCOPES)) {
    if (required === 'owner') continue
    for (const s of required.split('+')) {
      if (areaOf(s) === 'agent') continue
      const a = areas.get(areaLabel(s)) ?? { read: false, write: false }
      if (hasScope(actor.role, actor.scopes || [], s)) a[s.endsWith(':write') ? 'write' : 'read'] = true
      areas.set(areaLabel(s), a)
    }
  }
  const list = (keep: (a: { read: boolean; write: boolean }) => boolean) =>
    [...areas]
      .filter(([, a]) => keep(a))
      .map(([label]) => label)
      .sort()
      .join(', ')
  const view = list(a => a.read || a.write)
  const change = list(a => a.write)
  const none = list(a => !a.read && !a.write)

  const owner = isPlatformOwner(actor.role)
  const role = ROLE_LABELS[actor.role] ?? actor.role.replace(/_/g, ' ')
  const lines = [
    `## This admin's access`,
    `Role: **${role}**. Every change you propose still needs their approval, and runs with their permissions.`,
    `- Can view: ${view || 'nothing'}.`,
    `- Can change: ${change || 'nothing'}.`,
  ]
  if (none) {
    lines.push(`- No access to: ${none}. Don't call those tools; say their role or plan doesn't include it.`)
  }
  lines.push(
    owner
      ? '- Order/payment status overrides: **allowed** (propose_update_order_status / propose_set_payment_status with override and a 10–500 character reason). Only when the user asks to bypass the normal flow; it skips the status rules and is audit-logged.'
      : `- Order/payment status overrides: **not allowed** — only an ${OWNER_ONLY} can override. Follow the normal status flow; if they need an override, tell them to ask an owner.`
  )
  lines.push(
    toolAllowed('propose_refund_order', actor)
      ? '- Refunds: use get_order_refund_options, then propose_refund_order. Never mark a payment "refunded" as a plain status change.'
      : '- Refunds: not allowed (needs Orders write).'
  )
  if (!owner) lines.push(`- Raw SQL, schema, repo files and the generic admin API tool are ${OWNER_ONLY} only.`)
  return lines.join('\n')
}

/**
 * Order writes the generic admin API tool must not make: each has a dedicated tool that applies the
 * status rules, role checks and side effects. Returns that tool's name, or null.
 */
export function dedicatedOrderTool(method: string, path: string, body?: string | null): string | null {
  const p = path.split('?')[0].replace(/\/+$/, '')
  if (!/^\/api\/admin\/orders\//.test(p) || method.toUpperCase() === 'GET' || method.toUpperCase() === 'HEAD') return null
  if (/\/refunds?(\/|$)/.test(p)) return 'propose_refund_order'
  if (/^\/api\/admin\/orders\/[^/]+\/payment-status$/.test(p)) return 'propose_set_payment_status (or propose_mark_invoice_paid)'
  if (/^\/api\/admin\/orders\/[^/]+\/cancel$/.test(p)) return 'propose_cancel_order'
  if (/^\/api\/admin\/orders\/[^/]+$/.test(p) && ['PATCH', 'PUT'].includes(method.toUpperCase())) {
    let parsed: any = null
    try {
      parsed = body ? JSON.parse(body) : null
    } catch {}
    if (parsed && typeof parsed === 'object' && ('status' in parsed || 'payment_status' in parsed)) {
      return 'propose_update_order_status'
    }
  }
  return null
}
