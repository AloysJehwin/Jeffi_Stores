'use client'

import { useRef, useState, useEffect } from 'react'
import { Bot, Send, MessageSquare, Slash, LayoutGrid, CheckCircle, XCircle, Loader2, Plus, History, Paperclip, X } from 'lucide-react'
import { useToast } from '@/contexts/ToastContext'
import AdminAgentMessage from '@/components/admin/AdminAgentMessage'
import AdminAgentBlocks, { type UiBlock } from '@/components/admin/AdminAgentBlocks'

interface ProposedAction {
  id: string
  kind: string
  payload: Record<string, unknown>
  confirmation: string
  status: 'proposed' | 'approving' | 'approved' | 'rejected' | 'failed'
  result?: unknown
  error?: string
}

interface ToolCall {
  tool: string
  input: Record<string, unknown>
  output: unknown
  isError?: boolean
}

interface PickerOption {
  id: string
  label: string
  sublabel?: string
}

interface Picker {
  choice_kind: string
  options: PickerOption[]
  note?: string
}

interface ChatTurn {
  id: string
  role: 'user' | 'assistant'
  content: string
  model?: string
  toolCalls?: ToolCall[]
  proposedActions?: ProposedAction[]
  pickers?: Picker[]
  pickerResolved?: boolean
  uiBlocks?: UiBlock[]
}

const SLASH_COMMANDS = [
  { command: '/find-customer', example: '/find-customer aloys@gmail.com', description: 'Get full customer profile + LTV' },
  { command: '/products-top', example: '/products-top', description: 'Top selling products in the last 30 days' },
  { command: '/restock-suggestions', example: '/restock-suggestions', description: 'Low-stock items that need ordering' },
  { command: '/stuck-shipments', example: '/stuck-shipments', description: 'Orders shipped >3 days ago, not delivered' },
  { command: '/campaign-stats', example: '/campaign-stats', description: 'Campaign performance for the last 30 days' },
]

interface ToolEntry {
  name: string
  label: string
  description: string
  mutating: boolean
  prompt: string
}
interface ToolGroup {
  group: string
  tools: ToolEntry[]
}

const TOOL_GROUPS: ToolGroup[] = [
  {
    group: 'Products & Catalog',
    tools: [
      { name: 'search_products', label: 'Search products', description: 'Semantic search over the full catalog', mutating: false, prompt: 'Search products for:' },
      { name: 'get_product', label: 'Get product', description: 'Full details by id or slug', mutating: false, prompt: 'Get product details for:' },
      { name: 'get_product_variants', label: 'Get product variants', description: 'List variants for a product', mutating: false, prompt: 'Show variants for product id:' },
      { name: 'find_similar_products', label: 'Find similar products', description: 'Semantically similar products by product id', mutating: false, prompt: 'Find products similar to product id:' },
      { name: 'get_recent_products', label: 'Recent products', description: 'Most recently added active products', mutating: false, prompt: 'Show me the 10 most recently added products' },
      { name: 'get_featured_products', label: 'Featured products', description: 'Products flagged is_featured=true', mutating: false, prompt: 'Show me all featured products' },
      { name: 'get_low_stock_products', label: 'Low stock products', description: 'Products at or below a stock threshold, sorted by 30-day sales', mutating: false, prompt: 'Show me products with stock <= 5, sorted by how much they sold in the last 30 days' },
      { name: 'list_featured_products', label: 'List featured products', description: 'Featured products with stock and price', mutating: false, prompt: 'List all featured products' },
      { name: 'list_inventory_low', label: 'Inventory low list', description: 'Products below reorder threshold', mutating: false, prompt: 'List products below their low-stock threshold' },
      { name: 'get_product_full', label: 'Get full product', description: 'Product with variants and sub-variants', mutating: false, prompt: 'Get full product details including variants for:' },
      { name: 'list_brands', label: 'List brands', description: 'All brands in the catalog', mutating: false, prompt: 'List all brands' },
      { name: 'get_brand', label: 'Get brand', description: 'Brand details by id or slug', mutating: false, prompt: 'Get brand details for:' },
      { name: 'list_categories', label: 'List categories', description: 'All product categories', mutating: false, prompt: 'List all categories' },
      { name: 'get_category', label: 'Get category', description: 'Category details by id or slug', mutating: false, prompt: 'Get category details for:' },
      { name: 'propose_create_product', label: 'Create product', description: 'Propose creating a new product (requires approval)', mutating: true, prompt: 'Propose creating a new product with name:' },
      { name: 'propose_update_product', label: 'Update product', description: 'Propose updating a product field (requires approval)', mutating: true, prompt: 'Propose updating product:' },
      { name: 'propose_adjust_inventory', label: 'Adjust inventory', description: 'Propose changing a product\'s stock (requires approval)', mutating: true, prompt: 'Propose adjusting inventory for product:' },
      { name: 'propose_set_product_featured', label: 'Set product featured', description: 'Propose featuring or unfeaturing a product', mutating: true, prompt: 'Propose setting product featured status for:' },
      { name: 'propose_create_brand', label: 'Create brand', description: 'Propose adding a new brand (requires approval)', mutating: true, prompt: 'Propose creating a new brand:' },
    ],
  },
  {
    group: 'Orders & Customers',
    tools: [
      { name: 'get_recent_orders', label: 'Recent orders', description: 'Orders filtered by status, user, or days back', mutating: false, prompt: 'Show me orders from the last 7 days' },
      { name: 'get_order', label: 'Get order', description: 'Full order detail including line items', mutating: false, prompt: 'Get order details for order number:' },
      { name: 'search_customers', label: 'Search customers', description: 'Find customers by name, email, or phone fragment', mutating: false, prompt: 'Search for customer:' },
      { name: 'get_customer', label: 'Get customer', description: 'Customer profile with LTV and order count', mutating: false, prompt: 'Get customer profile for email:' },
      { name: 'find_customer_orders', label: 'Customer orders', description: 'Look up a customer by name/email and list their orders', mutating: false, prompt: 'Show me all orders for customer:' },
      { name: 'mark_order_shipped', label: 'Mark order shipped', description: 'Propose marking an order as shipped (requires approval)', mutating: true, prompt: 'Mark order as shipped — order number:' },
      { name: 'propose_order_delay_email', label: 'Order delay email', description: 'Propose sending a delay notification to a customer', mutating: true, prompt: 'Send delay notification for order:' },
      { name: 'propose_update_order_status', label: 'Update order status', description: 'Propose changing order status (requires approval)', mutating: true, prompt: 'Update status for order:' },
    ],
  },
  {
    group: 'Quotations, Invoices & Cash Sales',
    tools: [
      { name: 'list_quotations', label: 'List quotations', description: 'Recent quotations with status filter', mutating: false, prompt: 'List recent quotations' },
      { name: 'get_quotation', label: 'Get quotation', description: 'Full quotation detail with line items', mutating: false, prompt: 'Get quotation details for:' },
      { name: 'list_invoices', label: 'List invoices', description: 'Recent invoices with status and date filter', mutating: false, prompt: 'List recent invoices' },
      { name: 'get_invoice', label: 'Get invoice', description: 'Full invoice detail with line items', mutating: false, prompt: 'Get invoice details for:' },
      { name: 'list_cash_sales', label: 'List cash sales', description: 'Recent cash sales', mutating: false, prompt: 'List recent cash sales' },
      { name: 'get_cash_sale', label: 'Get cash sale', description: 'Full cash sale detail', mutating: false, prompt: 'Get cash sale details for:' },
      { name: 'match_quotation_items', label: 'Match quotation items', description: 'Resolve free-text line items to real products', mutating: false, prompt: 'Match these items to products:' },
      { name: 'extract_quotation_lines_from_attachment', label: 'Extract quotation from attachment', description: 'Parse product lines from an uploaded PDF or image', mutating: false, prompt: 'Extract quotation lines from the attached file' },
      { name: 'propose_create_quotation', label: 'Create quotation', description: 'Propose creating a new quotation (requires approval)', mutating: true, prompt: 'Create a quotation for customer:' },
      { name: 'propose_send_quotation_email', label: 'Send quotation email', description: 'Propose emailing a quotation to the customer', mutating: true, prompt: 'Send quotation email for quotation id:' },
      { name: 'propose_mark_invoice_paid', label: 'Mark invoice paid', description: 'Propose marking an invoice as paid (requires approval)', mutating: true, prompt: 'Mark invoice as paid — invoice id:' },
    ],
  },
  {
    group: 'Marketing & Campaigns',
    tools: [
      { name: 'get_campaign_stats', label: 'Campaign stats', description: 'Sent / opened / clicked / converted metrics', mutating: false, prompt: 'Get campaign performance stats for the last 30 days' },
      { name: 'list_campaigns', label: 'List campaigns', description: 'All behavioral campaigns and their status', mutating: false, prompt: 'List all email campaigns' },
      { name: 'get_campaign', label: 'Get campaign', description: 'Campaign detail and current template', mutating: false, prompt: 'Get details for campaign:' },
      { name: 'list_coupons', label: 'List coupons', description: 'All coupons with usage and expiry info', mutating: false, prompt: 'List all active coupons' },
      { name: 'get_coupon', label: 'Get coupon', description: 'Coupon detail including eligible users', mutating: false, prompt: 'Get details for coupon code:' },
      { name: 'list_mailer_templates', label: 'List mailer templates', description: 'All configured email templates', mutating: false, prompt: 'List all mailer templates' },
      { name: 'estimate_email_audience', label: 'Estimate email audience', description: 'Count recipients before a blast — always run first', mutating: false, prompt: 'How many customers would receive an email to all_opted_in audience?' },
      { name: 'send_test_email', label: 'Send test email', description: 'Propose sending a test campaign email (requires approval)', mutating: true, prompt: 'Send a test of campaign abandoned_cart to:' },
      { name: 'toggle_campaign_enabled', label: 'Toggle campaign', description: 'Propose enabling or disabling a campaign (requires approval)', mutating: true, prompt: 'Disable campaign:' },
      { name: 'propose_create_coupon', label: 'Create coupon', description: 'Propose creating a discount coupon (requires approval)', mutating: true, prompt: 'Create a 10% discount coupon with code:' },
      { name: 'propose_generate_personalized_coupon', label: 'Generate personalized coupon', description: 'Propose a one-time coupon for a specific customer', mutating: true, prompt: 'Generate a personalized coupon for customer email:' },
      { name: 'propose_update_campaign_template', label: 'Update campaign template', description: 'Propose editing a campaign email template (requires approval)', mutating: true, prompt: 'Update the email template for campaign:' },
      { name: 'propose_send_mailer_broadcast', label: 'Send mailer broadcast', description: 'Propose a one-off email blast to an audience (requires approval)', mutating: true, prompt: 'Send a broadcast email to all opted-in customers about:' },
      { name: 'propose_product_announcement_email', label: 'Product announcement email', description: 'Propose emailing featured products to an audience (requires approval)', mutating: true, prompt: 'Send a product announcement email featuring products:' },
    ],
  },
  {
    group: 'Customer Ops',
    tools: [
      { name: 'get_customer_notes', label: 'Customer notes', description: 'All notes on a customer', mutating: false, prompt: 'Show notes for customer email:' },
      { name: 'get_customer_tasks', label: 'Customer tasks', description: 'Open and closed tasks for a customer', mutating: false, prompt: 'Show tasks for customer email:' },
      { name: 'get_customer_tags', label: 'Customer tags', description: 'Tags assigned to a customer', mutating: false, prompt: 'Show tags for customer email:' },
      { name: 'get_customer_health', label: 'Customer health', description: 'Order history, churn risk, and engagement score', mutating: false, prompt: 'Show health score for customer email:' },
      { name: 'list_tag_definitions', label: 'List tag definitions', description: 'All available customer tag types', mutating: false, prompt: 'List all customer tag definitions' },
      { name: 'list_customers_by_tag', label: 'Customers by tag', description: 'Find all customers with a specific tag', mutating: false, prompt: 'List customers with tag:' },
      { name: 'list_open_tasks', label: 'Open tasks', description: 'All unresolved customer ops tasks', mutating: false, prompt: 'List all open customer tasks' },
      { name: 'propose_add_customer_note', label: 'Add customer note', description: 'Propose adding a note to a customer', mutating: true, prompt: 'Add a note to customer email:' },
      { name: 'propose_add_customer_tag', label: 'Add customer tag', description: 'Propose tagging a customer', mutating: true, prompt: 'Tag customer email: with tag:' },
      { name: 'propose_remove_customer_tag', label: 'Remove customer tag', description: 'Propose removing a tag from a customer', mutating: true, prompt: 'Remove tag from customer email:' },
      { name: 'propose_create_customer_task', label: 'Create customer task', description: 'Propose creating a follow-up task for a customer', mutating: true, prompt: 'Create a task for customer email:' },
      { name: 'propose_close_customer_task', label: 'Close customer task', description: 'Propose marking a task resolved', mutating: true, prompt: 'Close task id:' },
      { name: 'propose_toggle_marketing_opt_out', label: 'Toggle marketing opt-out', description: 'Propose updating a customer\'s marketing preference', mutating: true, prompt: 'Toggle marketing opt-out for customer email:' },
      { name: 'propose_create_tag_definition', label: 'Create tag definition', description: 'Propose adding a new customer tag type', mutating: true, prompt: 'Create a new customer tag called:' },
    ],
  },
  {
    group: 'Operations & Finance',
    tools: [
      { name: 'list_pending_pickups', label: 'Pending pickups', description: 'Orders awaiting Delhivery pickup', mutating: false, prompt: 'List all orders pending pickup' },
      { name: 'list_recent_pickups', label: 'Recent pickups', description: 'Recently scheduled Delhivery pickups', mutating: false, prompt: 'Show recent Delhivery pickups' },
      { name: 'list_payables', label: 'List payables', description: 'Outstanding supplier invoices and expenses', mutating: false, prompt: 'List all unpaid payables' },
      { name: 'list_receivables', label: 'List receivables', description: 'Unpaid customer invoices', mutating: false, prompt: 'List all unpaid receivables' },
      { name: 'get_cashflow_summary', label: 'Cashflow summary', description: 'Cash in vs out over a date range', mutating: false, prompt: 'Show cashflow summary for the last 30 days' },
      { name: 'get_pl_summary', label: 'P&L summary', description: 'Revenue, cost, and gross profit', mutating: false, prompt: 'Show P&L summary for this month' },
      { name: 'get_gst_summary', label: 'GST summary', description: 'GST collected and input credit by period', mutating: false, prompt: 'Show GST summary for this quarter' },
      { name: 'list_recent_transactions', label: 'Recent transactions', description: 'Latest financial transactions', mutating: false, prompt: 'Show recent transactions' },
      { name: 'propose_create_pickup_request', label: 'Create pickup request', description: 'Propose scheduling a Delhivery pickup (requires approval)', mutating: true, prompt: 'Schedule a Delhivery pickup for order:' },
      { name: 'propose_sync_delhivery_statuses', label: 'Sync Delhivery statuses', description: 'Propose syncing shipment statuses from Delhivery', mutating: true, prompt: 'Sync Delhivery shipment statuses' },
      { name: 'propose_pay_payable', label: 'Pay payable', description: 'Propose recording a payment for an outstanding payable', mutating: true, prompt: 'Mark payable id: as paid' },
      { name: 'propose_export_gstr1', label: 'Export GSTR-1', description: 'Propose generating and downloading a GSTR-1 export', mutating: true, prompt: 'Export GSTR-1 for the month:' },
    ],
  },
  {
    group: 'Data & Admin',
    tools: [
      { name: 'run_sql_readonly', label: 'Run SQL', description: 'Ad-hoc SELECT query against the live database', mutating: false, prompt: 'Run a SQL query to:' },
      { name: 'describe_schema', label: 'Describe schema', description: 'List tables or columns in a given table', mutating: false, prompt: 'Describe the schema of table:' },
      { name: 'list_admin_api_routes', label: 'List admin API routes', description: 'Show available /api/admin/* endpoints', mutating: false, prompt: 'List admin API routes' },
      { name: 'call_admin_api', label: 'Call admin API', description: 'Call any /api/admin/* endpoint — writes require approval', mutating: true, prompt: 'Call the admin API:' },
      { name: 'list_repo_files', label: 'List repo files', description: 'Browse source files in a project directory', mutating: false, prompt: 'List files in src/lib' },
      { name: 'read_repo_file', label: 'Read repo file', description: 'Read a source file to understand implementation', mutating: false, prompt: 'Read the file at path:' },
      { name: 'list_admin_tools', label: 'List all tools', description: 'Introspect every tool the agent has access to', mutating: false, prompt: 'What tools do you have? List all of them.' },
    ],
  },
]

interface ConversationListItem {
  id: string
  title: string | null
  preview: string | null
  last_message_at: string
  message_count: number
}

type Tab = 'chat' | 'slash' | 'tools'

export default function AdminAgentPage() {
  const { showToast } = useToast()
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [tab, setTab] = useState<Tab>('chat')
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [conversationId, setConversationId] = useState<string | null>(null)
  const [turns, setTurns] = useState<ChatTurn[]>([])
  const [showHistory, setShowHistory] = useState(false)
  const [conversations, setConversations] = useState<ConversationListItem[]>([])
  const [loadingHistory, setLoadingHistory] = useState(false)
  const [pendingFile, setPendingFile] = useState<File | null>(null)
  const [uploading, setUploading] = useState(false)
  const [attachmentId, setAttachmentId] = useState<string | null>(null)

  useEffect(() => {
    inputRef.current?.focus()
    loadConversations()
  }, [])

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight
  }, [turns, loading])

  function clearAttachment() {
    setPendingFile(null)
    setAttachmentId(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  function onPickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    if (!f) return
    if (f.size > 5 * 1024 * 1024) { showToast('File too large (max 5MB)', 'error'); e.target.value = ''; return }
    const allowed = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
    if (!allowed.includes(f.type)) { showToast('Only JPG, PNG, WEBP, or PDF files are supported', 'error'); e.target.value = ''; return }
    setPendingFile(f)
    setAttachmentId(null)
  }

  async function uploadPendingFile(): Promise<string | null> {
    if (!pendingFile) return null
    if (attachmentId) return attachmentId
    setUploading(true)
    try {
      const fd = new FormData()
      fd.append('file', pendingFile)
      const res = await fetch('/api/admin/agent/upload', { method: 'POST', credentials: 'include', body: fd })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) { showToast(data.error || 'Upload failed', 'error'); return null }
      setAttachmentId(data.attachment_id)
      return data.attachment_id as string
    } catch (e: any) {
      showToast(e?.message || 'Upload failed', 'error')
      return null
    } finally {
      setUploading(false)
    }
  }

  async function loadConversations() {
    setLoadingHistory(true)
    try {
      const res = await fetch('/api/admin/agent/conversations?limit=30', { credentials: 'include' })
      if (res.ok) { const data = await res.json(); setConversations(data.items || []) }
    } finally { setLoadingHistory(false) }
  }

  async function loadConversation(id: string) {
    setLoading(true)
    try {
      const res = await fetch(`/api/admin/agent/conversations/${id}/messages`, { credentials: 'include' })
      if (!res.ok) { showToast('Failed to load conversation', 'error'); return }
      const data = await res.json()
      const restored: ChatTurn[] = (data.messages || []).map((m: any) => ({
        id: m.id || crypto.randomUUID(),
        role: m.role,
        content: m.content,
        toolCalls: m.tool_calls?.length ? m.tool_calls : undefined,
        uiBlocks: m.ui_blocks?.length ? m.ui_blocks : undefined,
        proposedActions: m.proposed_actions?.length
          ? m.proposed_actions.map((a: any) => ({ ...a, status: a.status ?? 'approved' }))
          : undefined,
        pickers: m.pickers?.length ? m.pickers : undefined,
        pickerResolved: m.pickers?.length ? true : undefined,
      }))
      setTurns(restored)
      setConversationId(id)
      setShowHistory(false)
    } finally { setLoading(false) }
  }

  function newChat() {
    setTurns([])
    setConversationId(null)
    setInput('')
    setShowHistory(false)
    setTimeout(() => inputRef.current?.focus(), 50)
  }

  async function sendMessage(text: string) {
    const trimmed = text.trim()
    const hasFile = !!pendingFile
    if ((!trimmed && !hasFile) || loading) return

    let attId = attachmentId
    if (hasFile && !attId) {
      attId = await uploadPendingFile()
      if (!attId) return
    }

    const fileNote = pendingFile ? ` [attachment_id=${attId} filename="${pendingFile.name}" mime=${pendingFile.type}]` : ''
    const finalUserText = (trimmed || (hasFile ? `Process the attached ${pendingFile?.type.startsWith('image/') ? 'image' : 'PDF'} as a quotation request.` : '')) + fileNote
    const displayContent = trimmed || `📎 ${pendingFile?.name || 'attachment'}`

    setTurns(t => [...t, { id: crypto.randomUUID(), role: 'user', content: displayContent }])
    setInput('')
    clearAttachment()
    setLoading(true)
    try {
      const res = await fetch('/api/admin/agent/chat', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversationId, message: finalUserText }),
      })
      const data = await res.json()
      if (!res.ok) {
        showToast(data.error || 'Agent error', 'error')
        setTurns(t => [...t, { id: crypto.randomUUID(), role: 'assistant', content: `Error: ${data.error || 'unknown'}` }])
        return
      }
      if (data.conversationId) setConversationId(data.conversationId)
      setTurns(t => [...t, {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: data.message,
        model: data.model || undefined,
        toolCalls: data.toolCalls,
        proposedActions: (data.proposedActions || []).map((a: any) => ({ ...a, status: 'proposed' as const })),
        pickers: data.pickers || [],
        uiBlocks: data.uiBlocks || [],
      }])
    } catch (err: any) {
      showToast(err?.message || 'Network error', 'error')
    } finally {
      setLoading(false)
    }
  }

  async function decideAction(turnId: string, actionId: string, decision: 'approve' | 'reject') {
    setTurns(prev => prev.map(t => t.id !== turnId ? t : {
      ...t, proposedActions: t.proposedActions?.map(a => a.id !== actionId ? a : { ...a, status: 'approving' }),
    }))
    try {
      const res = await fetch(`/api/admin/agent/actions/${actionId}/${decision}`, { method: 'POST', credentials: 'include' })
      const data = await res.json()
      const newStatus: ProposedAction['status'] = !res.ok ? 'failed' : decision === 'reject' ? 'rejected' : 'approved'
      setTurns(prev => prev.map(t => t.id !== turnId ? t : {
        ...t, proposedActions: t.proposedActions?.map(a => a.id !== actionId ? a : { ...a, status: newStatus, result: data.result, error: data.error }),
      }))
      if (!res.ok) showToast(data.error || 'Action failed', 'error')
      else showToast(decision === 'approve' ? 'Action executed' : 'Action rejected', 'success')
    } catch (err: any) {
      setTurns(prev => prev.map(t => t.id !== turnId ? t : {
        ...t, proposedActions: t.proposedActions?.map(a => a.id !== actionId ? a : { ...a, status: 'failed', error: err?.message }),
      }))
      showToast(err?.message || 'Network error', 'error')
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(input) }
  }

  return (
    <div className="h-full flex flex-col">
      {/* Page header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-border-default shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-accent-500 to-secondary-500 flex items-center justify-center shrink-0">
            <Bot className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-base font-semibold text-foreground">Admin Assistant</h1>
            <p className="text-xs text-foreground-muted">Read-only chat + admin-approved actions</p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button onClick={newChat} className="p-1.5 rounded-lg text-foreground-muted hover:text-foreground hover:bg-surface-secondary transition-colors" title="New chat">
            <Plus className="w-4 h-4" />
          </button>
          <button
            onClick={() => setShowHistory(s => !s)}
            className={`p-1.5 rounded-lg transition-colors ${showHistory ? 'bg-surface-secondary text-foreground' : 'text-foreground-muted hover:text-foreground hover:bg-surface-secondary'}`}
            title="Chat history"
          >
            <History className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 px-4 border-b border-border-default shrink-0">
        {([
          { id: 'chat', label: 'Chat', icon: MessageSquare },
          { id: 'slash', label: 'Slash', icon: Slash },
          { id: 'tools', label: 'Tools', icon: LayoutGrid },
        ] as const).map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`flex items-center gap-1.5 px-3 py-2.5 text-xs font-semibold transition-colors border-b-2 ${
              tab === id ? 'text-accent-600 dark:text-accent-400 border-accent-500' : 'text-foreground-muted hover:text-foreground border-transparent'
            }`}
          >
            <Icon className="w-3.5 h-3.5" />
            {label}
          </button>
        ))}
      </div>

      {/* Chat tab */}
      {tab === 'chat' && (
        <div className="flex flex-1 min-h-0">
          {/* History sidebar */}
          {showHistory && (
            <aside className="w-64 border-r border-border-default bg-surface-secondary/50 flex flex-col shrink-0">
              <div className="px-3 py-2 border-b border-border-default flex items-center justify-between">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-foreground-muted">Chat history</p>
                <button onClick={loadConversations} disabled={loadingHistory} className="text-[10px] text-foreground-muted hover:text-foreground">
                  {loadingHistory ? '...' : 'refresh'}
                </button>
              </div>
              <div className="overflow-y-auto flex-1 p-2 space-y-1">
                {conversations.length === 0 && !loadingHistory && (
                  <p className="text-[11px] text-foreground-muted p-2">No past conversations.</p>
                )}
                {conversations.map(c => (
                  <button
                    key={c.id}
                    onClick={() => loadConversation(c.id)}
                    className={`w-full text-left px-2 py-1.5 rounded transition-colors text-xs ${
                      c.id === conversationId ? 'bg-accent-500/10 border border-accent-500/30' : 'hover:bg-surface-secondary'
                    }`}
                  >
                    <p className="font-medium text-foreground truncate">{c.title || c.preview?.slice(0, 60) || 'Untitled chat'}</p>
                    <p className="text-[10px] text-foreground-muted">
                      {new Date(c.last_message_at).toLocaleString()} · {c.message_count} msg
                    </p>
                  </button>
                ))}
              </div>
            </aside>
          )}

          {/* Main chat area */}
          <div className="flex-1 flex flex-col min-w-0">
            <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-3 min-h-0">
              {turns.length === 0 && !loading && (
                <div className="text-center py-16">
                  <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-accent-500 to-secondary-500 flex items-center justify-center mx-auto mb-4">
                    <Bot className="w-7 h-7 text-white" />
                  </div>
                  <p className="text-sm font-medium text-foreground mb-1">How can I help?</p>
                  <p className="text-xs text-foreground-muted max-w-sm mx-auto">Ask me anything about the store. I can search products, look up orders, summarise customers, propose actions for your approval.</p>
                </div>
              )}
              {turns.map(turn => (
                <div key={turn.id} className={turn.role === 'user' ? 'flex justify-end' : ''}>
                  <div className={`max-w-[85%] rounded-lg px-3 py-2 text-sm ${
                    turn.role === 'user' ? 'bg-accent-500 text-white' : 'bg-surface-secondary text-foreground'
                  }`}>
                    {turn.role === 'user'
                      ? <p className="whitespace-pre-wrap leading-relaxed">{turn.content}</p>
                      : (
                        <>
                          {turn.content && <AdminAgentMessage text={turn.content} />}
                          {turn.uiBlocks && turn.uiBlocks.length > 0 && (
                            <div className={turn.content ? 'mt-3' : ''}>
                              <AdminAgentBlocks
                                blocks={turn.uiBlocks}
                                pickerResolved={turn.pickerResolved}
                                onPickOption={(kind, option) => {
                                  setTurns(prev => prev.map(t => t.id !== turn.id ? t : { ...t, pickerResolved: true }))
                                  sendMessage(`Use ${kind} id ${option.id} (${option.label}) for the previous request.`)
                                }}
                                onSendMessage={(msg) => {
                                  setTurns(prev => prev.map(t => t.id !== turn.id ? t : { ...t, pickerResolved: true }))
                                  sendMessage(msg)
                                }}
                              />
                            </div>
                          )}
                          {turn.model && <p className="mt-1.5 text-[10px] text-foreground-muted opacity-60">{turn.model}</p>}
                        </>
                      )}
                    {turn.toolCalls && turn.toolCalls.length > 0 && (
                      <details className="mt-2 text-[10px] opacity-70">
                        <summary className="cursor-pointer">{turn.toolCalls.length} tool call{turn.toolCalls.length === 1 ? '' : 's'}</summary>
                        <ul className="mt-1 space-y-0.5">
                          {turn.toolCalls.map((tc, i) => (
                            <li key={i} className="font-mono">{tc.isError ? '[err] ' : '[ok] '}{tc.tool}({Object.keys(tc.input).join(',')})</li>
                          ))}
                        </ul>
                      </details>
                    )}
                    {turn.pickers && turn.pickers.length > 0 && !turn.pickerResolved && (
                      <div className="mt-3 space-y-2">
                        {turn.pickers.map((picker, pi) => (
                          <div key={pi} className="rounded-lg border border-accent-300 dark:border-accent-700 bg-accent-50 dark:bg-accent-900/10 p-3">
                            <p className="text-xs font-semibold text-accent-900 dark:text-accent-200 mb-2">Pick a {picker.choice_kind}{picker.note ? ` — ${picker.note}` : ''}</p>
                            <div className="space-y-1">
                              {picker.options.map(opt => (
                                <button key={opt.id} type="button"
                                  onClick={() => {
                                    setTurns(prev => prev.map(t => t.id !== turn.id ? t : { ...t, pickerResolved: true }))
                                    sendMessage(`Use ${picker.choice_kind} id ${opt.id} (${opt.label}) for the previous request.`)
                                  }}
                                  className="w-full text-left px-3 py-1.5 rounded-md hover:bg-accent-100 dark:hover:bg-accent-900/30 transition-colors"
                                >
                                  <p className="text-sm font-medium text-foreground">{opt.label}</p>
                                  {opt.sublabel && <p className="text-[11px] text-foreground-muted">{opt.sublabel}</p>}
                                </button>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                    {turn.proposedActions && turn.proposedActions.length > 0 && (
                      <div className="mt-3 space-y-2">
                        {turn.proposedActions.map(action => (
                          <div key={action.id} className="rounded-lg border-2 border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/20 p-3">
                            <p className="text-xs font-semibold text-amber-900 dark:text-amber-200 mb-2">Pending approval — {action.kind}</p>
                            <p className="text-xs text-foreground mb-3">{action.confirmation}</p>
                            {action.status === 'proposed' && (
                              <div className="flex gap-2">
                                <button onClick={() => decideAction(turn.id, action.id, 'approve')} className="flex-1 px-3 py-1.5 bg-accent-500 hover:bg-accent-600 text-white rounded text-xs font-semibold flex items-center justify-center gap-1">
                                  <CheckCircle className="w-3.5 h-3.5" /> Approve
                                </button>
                                <button onClick={() => decideAction(turn.id, action.id, 'reject')} className="flex-1 px-3 py-1.5 bg-surface hover:bg-surface-secondary text-foreground rounded text-xs font-semibold flex items-center justify-center gap-1 border border-border-default">
                                  <XCircle className="w-3.5 h-3.5" /> Reject
                                </button>
                              </div>
                            )}
                            {action.status === 'approving' && <p className="text-xs text-foreground-muted flex items-center gap-1.5"><Loader2 className="w-3 h-3 animate-spin" /> Executing</p>}
                            {action.status === 'approved' && <p className="text-xs text-green-700 dark:text-green-300 flex items-center gap-1.5"><CheckCircle className="w-3 h-3" /> Executed</p>}
                            {action.status === 'rejected' && <p className="text-xs text-foreground-muted flex items-center gap-1.5"><XCircle className="w-3 h-3" /> Rejected</p>}
                            {action.status === 'failed' && <p className="text-xs text-red-700 dark:text-red-300">Failed: {action.error || 'unknown'}</p>}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              ))}
              {loading && (
                <div className="animate-pulse space-y-1">
                  <div className="max-w-[85%] rounded-lg px-3 py-2 bg-surface-secondary space-y-2">
                    <div className="h-3 w-48 bg-surface-elevated rounded" style={{ animationDelay: '0ms' }} />
                    <div className="h-3 w-64 bg-surface-elevated rounded" style={{ animationDelay: '50ms' }} />
                    <div className="h-3 w-40 bg-surface-elevated rounded" style={{ animationDelay: '100ms' }} />
                  </div>
                </div>
              )}
            </div>

            {/* Input bar */}
            <div className="border-t border-border-default p-3 flex flex-col gap-2 shrink-0">
              {pendingFile && (
                <div className="flex items-center gap-2 px-2 py-1.5 bg-surface-secondary rounded-lg text-xs">
                  <Paperclip className="w-3.5 h-3.5 text-foreground-muted shrink-0" />
                  <span className="truncate flex-1 text-foreground">{pendingFile.name}</span>
                  <span className="text-[10px] text-foreground-muted shrink-0">{(pendingFile.size / 1024).toFixed(0)} KB</span>
                  {uploading && <Loader2 className="w-3 h-3 animate-spin text-foreground-muted" />}
                  {attachmentId && <CheckCircle className="w-3 h-3 text-green-600" />}
                  <button type="button" onClick={clearAttachment} className="p-0.5 text-foreground-muted hover:text-foreground"><X className="w-3 h-3" /></button>
                </div>
              )}
              <div className="flex items-end gap-2">
                <input ref={fileInputRef} type="file" accept="image/jpeg,image/png,image/webp,application/pdf" onChange={onPickFile} className="hidden" />
                <textarea
                  ref={inputRef}
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  onKeyDown={onKeyDown}
                  rows={1}
                  maxLength={2000}
                  disabled={loading}
                  placeholder={pendingFile ? 'Add an instruction (optional) and send' : 'Ask anything about the store'}
                  className="flex-1 px-3 py-2 text-sm bg-surface text-foreground placeholder:text-foreground-muted rounded-lg border border-border-secondary focus:outline-none focus:ring-2 focus:ring-accent-500 resize-none"
                />
                <button type="button" onClick={() => fileInputRef.current?.click()} disabled={loading || uploading}
                  className="w-9 h-9 flex items-center justify-center text-foreground-muted hover:text-foreground hover:bg-surface-secondary rounded-lg disabled:opacity-50 shrink-0" title="Attach file">
                  <Paperclip className="w-4 h-4" />
                </button>
                <button onClick={() => sendMessage(input)} disabled={loading || uploading || (!pendingFile && input.trim().length < 2)}
                  className="w-9 h-9 flex items-center justify-center bg-accent-500 hover:bg-accent-600 text-white rounded-lg disabled:opacity-50 shrink-0">
                  <Send className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Slash tab */}
      {tab === 'slash' && (
        <div className="flex-1 overflow-y-auto p-4 space-y-2">
          <p className="text-xs text-foreground-muted mb-3">Quick commands. Click to send.</p>
          {SLASH_COMMANDS.map(cmd => (
            <button key={cmd.command} onClick={() => { setTab('chat'); sendMessage(cmd.example) }}
              className="w-full text-left px-3 py-2.5 rounded-lg border border-border-default hover:border-accent-500 hover:bg-surface-secondary transition-colors">
              <p className="text-sm font-mono text-accent-600 dark:text-accent-400">{cmd.example}</p>
              <p className="text-xs text-foreground-muted mt-0.5">{cmd.description}</p>
            </button>
          ))}
        </div>
      )}

      {/* Tools tab */}
      {tab === 'tools' && (
        <div className="flex-1 overflow-y-auto p-4 space-y-6">
          <p className="text-xs text-foreground-muted">Click any tool to send a prompt. <span className="inline-block px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-700">action</span> tools require your approval before executing.</p>
          {TOOL_GROUPS.map(group => (
            <div key={group.group}>
              <h3 className="text-[11px] font-semibold uppercase tracking-wider text-foreground-muted mb-2 px-0.5">{group.group}</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                {group.tools.map(t => (
                  <button
                    key={t.name}
                    onClick={() => { setTab('chat'); sendMessage(t.prompt) }}
                    className="text-left px-3 py-2.5 rounded-lg border border-border-default hover:border-accent-500 hover:bg-surface-secondary transition-colors group"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-sm font-medium text-foreground group-hover:text-accent-600 dark:group-hover:text-accent-400 leading-snug">{t.label}</p>
                      {t.mutating && (
                        <span className="shrink-0 inline-block px-1.5 py-0.5 rounded text-[9px] font-semibold bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-700 mt-0.5">action</span>
                      )}
                    </div>
                    <p className="text-[11px] text-foreground-muted mt-0.5 leading-snug">{t.description}</p>
                    <p className="text-[10px] font-mono text-foreground-muted/60 mt-1 truncate">{t.name}</p>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
