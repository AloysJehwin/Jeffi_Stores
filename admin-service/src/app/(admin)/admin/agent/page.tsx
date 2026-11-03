'use client'

import { useEffect, useState, Suspense } from 'react'
import { useRouter } from 'next/navigation'
import { Bot, MessageSquare, Slash, LayoutGrid, BarChart3, Plus, History, Users } from 'lucide-react'
import AgentChatPanel, { chatTitle } from '@/components/admin/agent/AgentChatPanel'
import { useAdminAgent } from '@/contexts/AdminAgentContext'
import { useAdminHost } from '@/contexts/AdminHostContext'
import { ap } from '@/lib/shared/admin-path'
import { RequireWrite } from '@/contexts/AdminScopesContext'
import { Tabs } from '@/components/admin/channels/ui'
import AgentOverview from './_components/AgentOverview'
import { PageHeader } from '@/components/admin/kit/layout'

const SLASH_COMMANDS = [
  {
    command: '/find-customer',
    example: '/find-customer aloys@gmail.com',
    description: 'Get full customer profile + LTV',
  },
  { command: '/products-top', example: '/products-top', description: 'Top selling products in the last 30 days' },
  {
    command: '/restock-suggestions',
    example: '/restock-suggestions',
    description: 'Low-stock items that need ordering',
  },
  {
    command: '/stuck-shipments',
    example: '/stuck-shipments',
    description: 'Orders shipped >3 days ago, not delivered',
  },
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
      {
        name: 'search_products',
        label: 'Search products',
        description: 'Semantic search over the full catalog',
        mutating: false,
        prompt: 'Search products for:',
      },
      {
        name: 'get_product',
        label: 'Get product',
        description: 'Full details by id or slug',
        mutating: false,
        prompt: 'Get product details for:',
      },
      {
        name: 'get_product_variants',
        label: 'Get product variants',
        description: 'List variants for a product',
        mutating: false,
        prompt: 'Show variants for product id:',
      },
      {
        name: 'find_similar_products',
        label: 'Find similar products',
        description: 'Semantically similar products by product id',
        mutating: false,
        prompt: 'Find products similar to product id:',
      },
      {
        name: 'get_recent_products',
        label: 'Recent products',
        description: 'Most recently added active products',
        mutating: false,
        prompt: 'Show me the 10 most recently added products',
      },
      {
        name: 'get_featured_products',
        label: 'Featured products',
        description: 'Products flagged is_featured=true',
        mutating: false,
        prompt: 'Show me all featured products',
      },
      {
        name: 'get_low_stock_products',
        label: 'Low stock products',
        description: 'Products at or below a stock threshold, sorted by 30-day sales',
        mutating: false,
        prompt: 'Show me products with stock <= 5, sorted by how much they sold in the last 30 days',
      },
      {
        name: 'list_featured_products',
        label: 'List featured products',
        description: 'Featured products with stock and price',
        mutating: false,
        prompt: 'List all featured products',
      },
      {
        name: 'list_inventory_low',
        label: 'Inventory low list',
        description: 'Products below reorder threshold',
        mutating: false,
        prompt: 'List products below their low-stock threshold',
      },
      {
        name: 'get_product_full',
        label: 'Get full product',
        description: 'Product with variants and sub-variants',
        mutating: false,
        prompt: 'Get full product details including variants for:',
      },
      {
        name: 'list_brands',
        label: 'List brands',
        description: 'All brands in the catalog',
        mutating: false,
        prompt: 'List all brands',
      },
      {
        name: 'get_brand',
        label: 'Get brand',
        description: 'Brand details by id or slug',
        mutating: false,
        prompt: 'Get brand details for:',
      },
      {
        name: 'list_categories',
        label: 'List categories',
        description: 'All product categories',
        mutating: false,
        prompt: 'List all categories',
      },
      {
        name: 'get_category',
        label: 'Get category',
        description: 'Category details by id or slug',
        mutating: false,
        prompt: 'Get category details for:',
      },
      {
        name: 'propose_create_product',
        label: 'Create product',
        description: 'Propose creating a new product (requires approval)',
        mutating: true,
        prompt: 'Propose creating a new product with name:',
      },
      {
        name: 'propose_update_product',
        label: 'Update product',
        description: 'Propose updating a product field (requires approval)',
        mutating: true,
        prompt: 'Propose updating product:',
      },
      {
        name: 'propose_adjust_inventory',
        label: 'Adjust inventory',
        description: "Propose changing a product's stock (requires approval)",
        mutating: true,
        prompt: 'Propose adjusting inventory for product:',
      },
      {
        name: 'propose_set_product_featured',
        label: 'Set product featured',
        description: 'Propose featuring or unfeaturing a product',
        mutating: true,
        prompt: 'Propose setting product featured status for:',
      },
      {
        name: 'propose_create_brand',
        label: 'Create brand',
        description: 'Propose adding a new brand (requires approval)',
        mutating: true,
        prompt: 'Propose creating a new brand:',
      },
    ],
  },
  {
    group: 'Orders & Customers',
    tools: [
      {
        name: 'get_recent_orders',
        label: 'Recent orders',
        description: 'Orders filtered by status, user, or days back',
        mutating: false,
        prompt: 'Show me orders from the last 7 days',
      },
      {
        name: 'get_order',
        label: 'Get order',
        description: 'Full order detail including line items',
        mutating: false,
        prompt: 'Get order details for order number:',
      },
      {
        name: 'search_customers',
        label: 'Search customers',
        description: 'Find customers by name, email, or phone fragment',
        mutating: false,
        prompt: 'Search for customer:',
      },
      {
        name: 'get_customer',
        label: 'Get customer',
        description: 'Customer profile with LTV and order count',
        mutating: false,
        prompt: 'Get customer profile for email:',
      },
      {
        name: 'find_customer_orders',
        label: 'Customer orders',
        description: 'Look up a customer by name/email and list their orders',
        mutating: false,
        prompt: 'Show me all orders for customer:',
      },
      {
        name: 'mark_order_shipped',
        label: 'Mark order shipped',
        description: 'Propose marking an order as shipped (requires approval)',
        mutating: true,
        prompt: 'Mark order as shipped — order number:',
      },
      {
        name: 'propose_order_delay_email',
        label: 'Order delay email',
        description: 'Propose sending a delay notification to a customer',
        mutating: true,
        prompt: 'Send delay notification for order:',
      },
      {
        name: 'propose_update_order_status',
        label: 'Update order status',
        description: 'Propose changing order status (requires approval)',
        mutating: true,
        prompt: 'Update status for order:',
      },
    ],
  },
  {
    group: 'Quotations, Invoices & Cash Sales',
    tools: [
      {
        name: 'list_quotations',
        label: 'List quotations',
        description: 'Recent quotations with status filter',
        mutating: false,
        prompt: 'List recent quotations',
      },
      {
        name: 'get_quotation',
        label: 'Get quotation',
        description: 'Full quotation detail with line items',
        mutating: false,
        prompt: 'Get quotation details for:',
      },
      {
        name: 'list_invoices',
        label: 'List invoices',
        description: 'Recent invoices with status and date filter',
        mutating: false,
        prompt: 'List recent invoices',
      },
      {
        name: 'get_invoice',
        label: 'Get invoice',
        description: 'Full invoice detail with line items',
        mutating: false,
        prompt: 'Get invoice details for:',
      },
      {
        name: 'list_cash_sales',
        label: 'List cash sales',
        description: 'Recent cash sales',
        mutating: false,
        prompt: 'List recent cash sales',
      },
      {
        name: 'get_cash_sale',
        label: 'Get cash sale',
        description: 'Full cash sale detail',
        mutating: false,
        prompt: 'Get cash sale details for:',
      },
      {
        name: 'match_quotation_items',
        label: 'Match quotation items',
        description: 'Resolve free-text line items to real products',
        mutating: false,
        prompt: 'Match these items to products:',
      },
      {
        name: 'extract_quotation_lines_from_attachment',
        label: 'Extract quotation from attachment',
        description: 'Parse product lines from an uploaded PDF or image',
        mutating: false,
        prompt: 'Extract quotation lines from the attached file',
      },
      {
        name: 'propose_create_quotation',
        label: 'Create quotation',
        description: 'Propose creating a new quotation (requires approval)',
        mutating: true,
        prompt: 'Create a quotation for customer:',
      },
      {
        name: 'propose_send_quotation_email',
        label: 'Send quotation email',
        description: 'Propose emailing a quotation to the customer',
        mutating: true,
        prompt: 'Send quotation email for quotation id:',
      },
      {
        name: 'propose_mark_invoice_paid',
        label: 'Mark invoice paid',
        description: 'Propose marking an invoice as paid (requires approval)',
        mutating: true,
        prompt: 'Mark invoice as paid — invoice id:',
      },
    ],
  },
  {
    group: 'Marketing & Campaigns',
    tools: [
      {
        name: 'get_campaign_stats',
        label: 'Campaign stats',
        description: 'Sent / opened / clicked / converted metrics',
        mutating: false,
        prompt: 'Get campaign performance stats for the last 30 days',
      },
      {
        name: 'list_campaigns',
        label: 'List campaigns',
        description: 'All behavioral campaigns and their status',
        mutating: false,
        prompt: 'List all email campaigns',
      },
      {
        name: 'get_campaign',
        label: 'Get campaign',
        description: 'Campaign detail and current template',
        mutating: false,
        prompt: 'Get details for campaign:',
      },
      {
        name: 'list_coupons',
        label: 'List coupons',
        description: 'All coupons with usage and expiry info',
        mutating: false,
        prompt: 'List all active coupons',
      },
      {
        name: 'get_coupon',
        label: 'Get coupon',
        description: 'Coupon detail including eligible users',
        mutating: false,
        prompt: 'Get details for coupon code:',
      },
      {
        name: 'list_mailer_templates',
        label: 'List mailer templates',
        description: 'All configured email templates',
        mutating: false,
        prompt: 'List all mailer templates',
      },
      {
        name: 'estimate_email_audience',
        label: 'Estimate email audience',
        description: 'Count recipients before a blast — always run first',
        mutating: false,
        prompt: 'How many customers would receive an email to all_opted_in audience?',
      },
      {
        name: 'send_test_email',
        label: 'Send test email',
        description: 'Propose sending a test campaign email (requires approval)',
        mutating: true,
        prompt: 'Send a test of campaign abandoned_cart to:',
      },
      {
        name: 'toggle_campaign_enabled',
        label: 'Toggle campaign',
        description: 'Propose enabling or disabling a campaign (requires approval)',
        mutating: true,
        prompt: 'Disable campaign:',
      },
      {
        name: 'propose_create_coupon',
        label: 'Create coupon',
        description: 'Propose creating a discount coupon (requires approval)',
        mutating: true,
        prompt: 'Create a 10% discount coupon with code:',
      },
      {
        name: 'propose_generate_personalized_coupon',
        label: 'Generate personalized coupon',
        description: 'Propose a one-time coupon for a specific customer',
        mutating: true,
        prompt: 'Generate a personalized coupon for customer email:',
      },
      {
        name: 'propose_update_campaign_template',
        label: 'Update campaign template',
        description: 'Propose editing a campaign email template (requires approval)',
        mutating: true,
        prompt: 'Update the email template for campaign:',
      },
      {
        name: 'propose_send_mailer_broadcast',
        label: 'Send mailer broadcast',
        description: 'Propose a one-off email blast to an audience (requires approval)',
        mutating: true,
        prompt: 'Send a broadcast email to all opted-in customers about:',
      },
      {
        name: 'propose_product_announcement_email',
        label: 'Product announcement email',
        description: 'Propose emailing featured products to an audience (requires approval)',
        mutating: true,
        prompt: 'Send a product announcement email featuring products:',
      },
    ],
  },
  {
    group: 'Customer Ops',
    tools: [
      {
        name: 'get_customer_notes',
        label: 'Customer notes',
        description: 'All notes on a customer',
        mutating: false,
        prompt: 'Show notes for customer email:',
      },
      {
        name: 'get_customer_tasks',
        label: 'Customer tasks',
        description: 'Open and closed tasks for a customer',
        mutating: false,
        prompt: 'Show tasks for customer email:',
      },
      {
        name: 'get_customer_tags',
        label: 'Customer tags',
        description: 'Tags assigned to a customer',
        mutating: false,
        prompt: 'Show tags for customer email:',
      },
      {
        name: 'get_customer_health',
        label: 'Customer health',
        description: 'Order history, churn risk, and engagement score',
        mutating: false,
        prompt: 'Show health score for customer email:',
      },
      {
        name: 'list_tag_definitions',
        label: 'List tag definitions',
        description: 'All available customer tag types',
        mutating: false,
        prompt: 'List all customer tag definitions',
      },
      {
        name: 'list_customers_by_tag',
        label: 'Customers by tag',
        description: 'Find all customers with a specific tag',
        mutating: false,
        prompt: 'List customers with tag:',
      },
      {
        name: 'list_open_tasks',
        label: 'Open tasks',
        description: 'All unresolved customer ops tasks',
        mutating: false,
        prompt: 'List all open customer tasks',
      },
      {
        name: 'propose_add_customer_note',
        label: 'Add customer note',
        description: 'Propose adding a note to a customer',
        mutating: true,
        prompt: 'Add a note to customer email:',
      },
      {
        name: 'propose_add_customer_tag',
        label: 'Add customer tag',
        description: 'Propose tagging a customer',
        mutating: true,
        prompt: 'Tag customer email: with tag:',
      },
      {
        name: 'propose_remove_customer_tag',
        label: 'Remove customer tag',
        description: 'Propose removing a tag from a customer',
        mutating: true,
        prompt: 'Remove tag from customer email:',
      },
      {
        name: 'propose_create_customer_task',
        label: 'Create customer task',
        description: 'Propose creating a follow-up task for a customer',
        mutating: true,
        prompt: 'Create a task for customer email:',
      },
      {
        name: 'propose_close_customer_task',
        label: 'Close customer task',
        description: 'Propose marking a task resolved',
        mutating: true,
        prompt: 'Close task id:',
      },
      {
        name: 'propose_toggle_marketing_opt_out',
        label: 'Toggle marketing opt-out',
        description: "Propose updating a customer's marketing preference",
        mutating: true,
        prompt: 'Toggle marketing opt-out for customer email:',
      },
      {
        name: 'propose_create_tag_definition',
        label: 'Create tag definition',
        description: 'Propose adding a new customer tag type',
        mutating: true,
        prompt: 'Create a new customer tag called:',
      },
    ],
  },
  {
    group: 'Operations & Finance',
    tools: [
      {
        name: 'list_pending_pickups',
        label: 'Pending pickups',
        description: 'Orders awaiting Delhivery pickup',
        mutating: false,
        prompt: 'List all orders pending pickup',
      },
      {
        name: 'list_recent_pickups',
        label: 'Recent pickups',
        description: 'Recently scheduled Delhivery pickups',
        mutating: false,
        prompt: 'Show recent Delhivery pickups',
      },
      {
        name: 'list_payables',
        label: 'List payables',
        description: 'Outstanding supplier invoices and expenses',
        mutating: false,
        prompt: 'List all unpaid payables',
      },
      {
        name: 'list_receivables',
        label: 'List receivables',
        description: 'Unpaid customer invoices',
        mutating: false,
        prompt: 'List all unpaid receivables',
      },
      {
        name: 'get_cashflow_summary',
        label: 'Cashflow summary',
        description: 'Cash in vs out over a date range',
        mutating: false,
        prompt: 'Show cashflow summary for the last 30 days',
      },
      {
        name: 'get_pl_summary',
        label: 'P&L summary',
        description: 'Revenue, cost, and gross profit',
        mutating: false,
        prompt: 'Show P&L summary for this month',
      },
      {
        name: 'get_gst_summary',
        label: 'GST summary',
        description: 'GST collected and input credit by period',
        mutating: false,
        prompt: 'Show GST summary for this quarter',
      },
      {
        name: 'list_recent_transactions',
        label: 'Recent transactions',
        description: 'Latest financial transactions',
        mutating: false,
        prompt: 'Show recent transactions',
      },
      {
        name: 'propose_create_pickup_request',
        label: 'Create pickup request',
        description: 'Propose scheduling a Delhivery pickup (requires approval)',
        mutating: true,
        prompt: 'Schedule a Delhivery pickup for order:',
      },
      {
        name: 'propose_sync_delhivery_statuses',
        label: 'Sync Delhivery statuses',
        description: 'Propose syncing shipment statuses from Delhivery',
        mutating: true,
        prompt: 'Sync Delhivery shipment statuses',
      },
      {
        name: 'propose_pay_payable',
        label: 'Pay payable',
        description: 'Propose recording a payment for an outstanding payable',
        mutating: true,
        prompt: 'Mark payable id: as paid',
      },
      {
        name: 'propose_export_gstr1',
        label: 'Export GSTR-1',
        description: 'Propose generating and downloading a GSTR-1 export',
        mutating: true,
        prompt: 'Export GSTR-1 for the month:',
      },
    ],
  },
  {
    group: 'Data & Admin',
    tools: [
      {
        name: 'run_sql_readonly',
        label: 'Run SQL',
        description: 'Ad-hoc SELECT query against the live database',
        mutating: false,
        prompt: 'Run a SQL query to:',
      },
      {
        name: 'describe_schema',
        label: 'Describe schema',
        description: 'List tables or columns in a given table',
        mutating: false,
        prompt: 'Describe the schema of table:',
      },
      {
        name: 'list_admin_api_routes',
        label: 'List admin API routes',
        description: 'Show available /api/admin/* endpoints',
        mutating: false,
        prompt: 'List admin API routes',
      },
      {
        name: 'call_admin_api',
        label: 'Call admin API',
        description: 'Call any /api/admin/* endpoint — writes require approval',
        mutating: true,
        prompt: 'Call the admin API:',
      },
      {
        name: 'list_repo_files',
        label: 'List repo files',
        description: 'Browse source files in a project directory',
        mutating: false,
        prompt: 'List files in src/lib',
      },
      {
        name: 'read_repo_file',
        label: 'Read repo file',
        description: 'Read a source file to understand implementation',
        mutating: false,
        prompt: 'Read the file at path:',
      },
      {
        name: 'list_admin_tools',
        label: 'List all tools',
        description: 'Introspect every tool the agent has access to',
        mutating: false,
        prompt: 'What tools do you have? List all of them.',
      },
    ],
  },
]

type Tab = 'chat' | 'slash' | 'tools' | 'overview'

export default function AdminAgentPage() {
  const { chat } = useAdminAgent()
  const router = useRouter()
  const host = useAdminHost()
  const [tab, setTab] = useState<Tab>('chat')
  const [showHistory, setShowHistory] = useState(false)
  const [urlReady, setUrlReady] = useState(false)

  // ?c=<id> opens that chat (yours, or one shared with you); the URL then follows the open chat.
  useEffect(() => {
    const c = new URLSearchParams(window.location.search).get('c')
    if (c && c !== chat.conversationId) chat.loadConversation(c).finally(() => setUrlReady(true))
    else setUrlReady(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!urlReady) return
    if ((chat.conversationId ?? null) !== new URLSearchParams(window.location.search).get('c')) {
      router.replace(ap(`/admin/agent${chat.conversationId ? `?c=${chat.conversationId}` : ''}`, host), { scroll: false })
    }
  }, [urlReady, chat.conversationId, router, host])

  function newChat() {
    chat.reset()
    setShowHistory(false)
  }

  return (
    <div className="h-full flex flex-col">
      {/* Page header */}
      <div className="px-4 sm:px-6 py-4 border-b border-border-default shrink-0">
        <PageHeader
          title="Admin Assistant"
          description={
            chat.conversationId ? (
              <span className="inline-flex items-center gap-1.5">
                {chat.info.shared && <Users className="w-3.5 h-3.5 text-accent-500" />}
                {chatTitle(chat.info.title)}
                {chat.info.readOnly && ` · shared by ${chat.info.ownerName || 'another admin'}, read-only`}
              </span>
            ) : (
              'Your chats are private unless you share one. Changes need your approval.'
            )
          }
          media={
            <div className="w-9 h-9 rounded-xl bg-accent-500 flex items-center justify-center shrink-0">
              <Bot className="w-5 h-5 text-white" />
            </div>
          }
        />
      </div>

      {/* Tabs */}
      <div className="px-4 shrink-0">
        <Tabs
          tabs={[
            { id: 'chat' as const, label: 'Chat', icon: <MessageSquare className="w-3.5 h-3.5" /> },
            { id: 'overview' as const, label: 'Overview', icon: <BarChart3 className="w-3.5 h-3.5" /> },
            { id: 'slash' as const, label: 'Slash', icon: <Slash className="w-3.5 h-3.5" /> },
            { id: 'tools' as const, label: 'Tools', icon: <LayoutGrid className="w-3.5 h-3.5" /> },
          ]}
          value={tab}
          onChange={setTab}
          actions={
            <>
              <button
                onClick={newChat}
                className="p-1.5 rounded-lg text-foreground-muted hover:text-foreground hover:bg-surface-secondary transition-colors"
                title="New chat"
              >
                <Plus className="w-4 h-4" />
              </button>
              <button
                onClick={() => setShowHistory(s => !s)}
                className={`p-1.5 rounded-lg transition-colors ${showHistory ? 'bg-surface-secondary text-foreground' : 'text-foreground-muted hover:text-foreground hover:bg-surface-secondary'}`}
                title="Chat history"
              >
                <History className="w-4 h-4" />
              </button>
            </>
          }
        />
      </div>

      {tab === 'chat' && (
        <AgentChatPanel
          chat={chat}
          variant="page"
          showHistory={showHistory}
          onConversationPicked={() => setShowHistory(false)}
          approveWrapper={node => <RequireWrite scope="agent:write">{node}</RequireWrite>}
          empty={
            <div className="text-center py-16">
              <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-accent-500 to-secondary-500 flex items-center justify-center mx-auto mb-4">
                <Bot className="w-7 h-7 text-white" />
              </div>
              <p className="text-sm font-medium text-foreground mb-1">How can I help?</p>
              <p className="text-xs text-foreground-muted max-w-sm mx-auto">
                Ask me anything about the store. I can search products, look up orders, summarise customers, propose
                actions for your approval.
              </p>
            </div>
          }
        />
      )}

      {/* Slash tab */}
      {tab === 'slash' && (
        <div className="flex-1 overflow-y-auto p-4 space-y-2">
          <p className="text-xs text-foreground-muted mb-3">Quick commands. Click to send.</p>
          {SLASH_COMMANDS.map(cmd => (
            <button
              key={cmd.command}
              onClick={() => {
                setTab('chat')
                chat.sendMessage(cmd.example)
              }}
              className="w-full text-left px-3 py-2.5 rounded-lg border border-border-default hover:border-accent-500 hover:bg-surface-secondary transition-colors"
            >
              <p className="text-sm font-mono text-accent-500">{cmd.example}</p>
              <p className="text-xs text-foreground-muted mt-0.5">{cmd.description}</p>
            </button>
          ))}
        </div>
      )}

      {/* Tools tab */}
      {tab === 'overview' && (
        <div className="flex-1 overflow-y-auto p-4">
          <Suspense fallback={null}>
            <AgentOverview />
          </Suspense>
        </div>
      )}

      {tab === 'tools' && (
        <div className="flex-1 overflow-y-auto p-4 space-y-6">
          <p className="text-xs text-foreground-muted">
            Click any tool to send a prompt.{' '}
            <span className="inline-block px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-500/10 text-amber-700 dark:text-amber-400 border border-amber-500/40">
              action
            </span>{' '}
            tools require your approval before executing.
          </p>
          {TOOL_GROUPS.map(group => (
            <div key={group.group}>
              <h3 className="text-[11px] font-semibold uppercase tracking-wider text-foreground-muted mb-2 px-0.5">
                {group.group}
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                {group.tools.map(t => (
                  <button
                    key={t.name}
                    onClick={() => {
                      setTab('chat')
                      chat.sendMessage(t.prompt)
                    }}
                    className="text-left px-3 py-2.5 rounded-lg border border-border-default hover:border-accent-500 hover:bg-surface-secondary transition-colors group"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-sm font-medium text-foreground group-hover:text-accent-500 leading-snug">
                        {t.label}
                      </p>
                      {t.mutating && (
                        <span className="shrink-0 inline-block px-1.5 py-0.5 rounded text-[9px] font-semibold bg-amber-500/10 text-amber-700 dark:text-amber-400 border border-amber-500/40 mt-0.5">
                          action
                        </span>
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
