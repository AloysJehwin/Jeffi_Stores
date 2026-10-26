import { useState, type ReactNode } from 'react'
import { Linking, View } from 'react-native'
import { Image } from 'expo-image'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, CheckCircle2, ClipboardCheck, CreditCard, ExternalLink, FileText, ImageOff, MessageSquare, Pencil, Send } from 'lucide-react-native'
import {
  getRfq,
  getRfqMessages,
  resubmitRfq,
  respondToOffer,
  sendRfqMessage,
  updateRfq,
  type CounterItem,
  type RfqDetail,
  type RfqItem,
  type RfqMessage,
  type RfqOrder,
  type RfqStatus,
} from '../../../src/api/business'
import { applyDiscount } from '../../../src/components/account/hooks'
import { errMsg } from '../../../src/components/account/ui'
import { cleanDecimal, MAX_DISCOUNT_PCT, parseAmount, quotationUrl, RFQ_STATUS_LABEL, rfqTone, rupees0, useRequireBusiness } from '../../../src/components/business/rfq'
import { fmtQty, invoiceUrl } from '../../../src/components/orders/shared'
import { useStoreConfig } from '../../../src/hooks/useStoreConfig'
import { absUrl } from '../../../src/lib/links'
import { dateFormat, inr } from '../../../src/lib/format'
import { useTokens } from '../../../src/theme'
import {
  Badge,
  BodySmall,
  Button,
  Caption,
  Card,
  cn,
  confirm,
  Divider,
  EmptyState,
  FieldError,
  Label,
  Notice,
  Overline,
  Screen,
  Skeleton,
  Stepper,
  Text,
  TextField,
  TintedIcon,
  toast,
} from '../../../src/ui'

// Mirror of controller-service app/(business)/business/quotes/[id]/page.tsx: status, items with our /
// target / offered prices, edit while open, the negotiation thread and offer card, resubmit, documents
// and the linked order. One column: the web's sidebar (notes, order, status) follows the items.

// The item query also returns these (route.ts); the API module's type leaves them out.
type Item = RfqItem

interface EditLine {
  qty: string
  price: string
  notes: string
}

const TITLE = 'Quote Details'
const EDITABLE: RfqStatus[] = ['pending', 'reviewed', 'negotiating']
const STEPS: RfqStatus[] = ['pending', 'reviewed', 'negotiating', 'offer_accepted', 'converted']
const ORDER: RfqStatus[] = [...STEPS, 'rejected']

const submittedOn = dateFormat({ day: 'numeric', month: 'short', year: 'numeric' })
const sentAt = dateFormat({ day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

/** counter_items as an array (a json column can arrive as text). */
function counterOf(m: RfqMessage): CounterItem[] | null {
  const c = m.counter_items as unknown
  if (Array.isArray(c)) return c as CounterItem[]
  if (typeof c === 'string') {
    try {
      const v = JSON.parse(c)
      return Array.isArray(v) ? v : null
    } catch {
      return null
    }
  }
  return null
}

/** Our price for a line: catalog (variant) price per the line's unit, less the account's category discount. */
function pricing(item: Item, discountMap: Record<string, number>) {
  const uf = Number(item.unit_factor) > 1 ? Number(item.unit_factor) : 1
  const raw = item.variant_price ?? item.catalog_price
  const catalogUnit = raw != null ? Number(raw) * uf : null
  const discountPct = item.category_id ? (discountMap[item.category_id] ?? 0) : 0
  const businessUnitPrice = catalogUnit && discountPct > 0 ? applyDiscount(catalogUnit, discountPct) : null
  const rawMrp = item.variant_mrp ?? item.catalog_mrp
  return { catalogUnit, discountPct, businessUnitPrice, shown: businessUnitPrice ?? catalogUnit, catalogMrp: rawMrp != null ? Number(rawMrp) * uf : null }
}

/** The quotation's rate is ex-GST; back to incl-GST after its discount. */
function quotedPrice(item: Item): number | null {
  if (item.quoted_rate == null) return null
  const gst = item.quoted_gst_rate != null ? Number(item.quoted_gst_rate) : 18
  const disc = item.quoted_discount_pct != null ? Number(item.quoted_discount_pct) : 0
  return Number(item.quoted_rate) * (1 - disc / 100) * (1 + gst / 100)
}

const pctOff = (price: number | null, base: number | null) => (price != null && base && base > 0 ? Math.round((1 - price / base) * 100) : null)

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  return (parts.length > 1 ? parts[0][0] + parts[1][0] : parts[0]?.slice(0, 2) || 'JS').toUpperCase()
}

function DetailLoading() {
  const card = 'rounded-panel bg-surface-elevated p-4 dark:border dark:border-border-default'
  return (
    <View className="gap-4">
      <View className={card}>
        <View className="flex-row items-center gap-2">
          <Skeleton height={20} width={170} />
          <Skeleton height={22} width={96} rounded="rounded-full" />
        </View>
        <Skeleton height={12} width={130} className="mt-2" />
      </View>
      <View className={card}>
        <Skeleton height={12} width={120} className="mb-4" />
        {[0, 1].map(i => (
          <View key={i} className="mb-4 gap-3">
            <View className="flex-row gap-3">
              <Skeleton width={56} height={56} rounded="rounded-xl" />
              <View className="flex-1 gap-2">
                <Skeleton height={14} width="80%" />
                <Skeleton height={18} width={90} rounded="rounded-full" />
              </View>
            </View>
            <View className="flex-row gap-2">
              <Skeleton height={56} width="48%" rounded="rounded-xl" />
              <Skeleton height={56} width="48%" rounded="rounded-xl" />
            </View>
          </View>
        ))}
      </View>
      <View className={card}>
        <Skeleton height={12} width={80} className="mb-3" />
        <Skeleton height={44} width="70%" rounded="rounded-2xl" />
      </View>
    </View>
  )
}

function PriceTile({ label, tone = 'plain', children }: { label: string; tone?: 'plain' | 'target' | 'offer'; children: ReactNode }) {
  const frame =
    tone === 'target'
      ? 'border border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-900/20'
      : tone === 'offer'
        ? 'border border-purple-200 bg-purple-50 dark:border-purple-800 dark:bg-purple-900/20'
        : 'bg-surface-secondary'
  return (
    <View style={{ flexBasis: '45%', flexGrow: 1 }} className={cn('rounded-xl px-3 py-2.5', frame)}>
      <Text className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-foreground-muted">{label}</Text>
      {children}
    </View>
  )
}

const Dash = () => <Text className="text-sm text-foreground-muted">—</Text>

function ItemRow({ item, index, discountMap, offered, target }: { item: Item; index: number; discountMap: Record<string, number>; offered: number | undefined; target: number | null }) {
  const router = useRouter()
  const t = useTokens()
  const { catalogUnit, discountPct, businessUnitPrice, shown, catalogMrp } = pricing(item, discountMap)
  const quoted = quotedPrice(item)
  const offeredPrice = quoted ?? (offered != null ? Number(offered) : null)
  const reqPct = pctOff(target, shown)
  const offeredPct = item.quoted_rate != null && item.quoted_discount_pct != null ? Number(item.quoted_discount_pct) : pctOff(offeredPrice, shown)
  const hasOffer = offeredPrice != null
  const img = absUrl(item.image_url)
  const qty = Number(item.quantity)
  return (
    <View className={cn('gap-3 p-4', hasOffer && 'bg-purple-50/40 dark:bg-purple-900/10')}>
      <View className="flex-row gap-3">
        <View className="h-14 w-14 items-center justify-center overflow-hidden rounded-xl border border-border-default bg-surface">
          {img ? <Image source={{ uri: img }} recyclingKey={img} accessible={false} style={{ width: '100%', height: '100%' }} contentFit="contain" /> : <ImageOff size={20} color={t.foregroundMuted} />}
        </View>
        <View className="flex-1">
          <View className="flex-row items-start justify-between gap-2">
            <Text
              accessibilityRole={item.product_slug ? 'link' : undefined}
              onPress={item.product_slug ? () => router.push(`/product/${item.product_slug}`) : undefined}
              className="flex-1 text-sm font-semibold leading-5 text-foreground"
            >
              {item.description}
            </Text>
            <Caption className="font-mono">#{index + 1}</Caption>
          </View>
          <View className="mt-1 flex-row flex-wrap items-center gap-1.5">
            {!!item.variant_sku && <Badge label={item.variant_sku} size="sm" />}
            <Badge label={`${fmtQty(qty)} ${item.unit}`} size="sm" />
            {hasOffer && <Badge label="Offer received" tone="transit" size="sm" />}
          </View>
          {!!item.notes && <Caption className="mt-1 italic">{item.notes}</Caption>}
        </View>
      </View>
      <View className="flex-row flex-wrap gap-2">
        {shown != null && (
          <PriceTile label="Our Price">
            <Text className="text-sm font-bold text-foreground">₹{inr(shown)}</Text>
            <View className="mt-1 flex-row flex-wrap gap-1">
              {!!businessUnitPrice && catalogUnit != null && <Text className="text-[10px] text-foreground-muted line-through">₹{inr(catalogUnit)}</Text>}
              {!businessUnitPrice && catalogMrp != null && catalogMrp > Number(catalogUnit ?? 0) && (
                <Text className="text-[10px] text-foreground-muted line-through">MRP ₹{inr(catalogMrp)}</Text>
              )}
              {discountPct > 0 && <Text className="text-[10px] font-bold text-green-600 dark:text-green-400">{discountPct}% off</Text>}
            </View>
          </PriceTile>
        )}
        <PriceTile label="Your Target" tone={target != null ? 'target' : 'plain'}>
          {target != null ? (
            <>
              <Text className="text-sm font-bold text-amber-700 dark:text-amber-400">₹{inr(target)}</Text>
              {reqPct != null && reqPct > 0 && <Text className="mt-1 text-[10px] font-semibold text-amber-600 dark:text-amber-500">{reqPct}% discount</Text>}
            </>
          ) : (
            <Dash />
          )}
        </PriceTile>
        <PriceTile label={item.quoted_rate != null ? 'Quoted Price' : 'Offered'} tone={hasOffer ? 'offer' : 'plain'}>
          {hasOffer ? (
            <>
              <Text className="text-sm font-bold text-purple-700 dark:text-purple-300">₹{inr(offeredPrice)}</Text>
              {offeredPct != null && offeredPct > 0 && <Text className="mt-1 text-[10px] font-semibold text-purple-600 dark:text-purple-400">{offeredPct}% off</Text>}
            </>
          ) : (
            <Dash />
          )}
        </PriceTile>
        <PriceTile label="Line Total">
          {shown != null ? <Text className="text-sm font-bold text-foreground">₹{rupees0(shown * qty)}</Text> : <Dash />}
          {target != null && <Text className="mt-1 text-[10px] text-foreground-muted">Target: ₹{rupees0(target * qty)}</Text>}
        </PriceTile>
      </View>
    </View>
  )
}

function EditRow({ item, index, line, minPrice, onChange }: { item: Item; index: number; line: EditLine; minPrice: number | null; onChange: (patch: Partial<EditLine>) => void }) {
  const q = parseFloat(line.qty)
  const qty = Number.isFinite(q) ? q : 0
  const target = parseAmount(line.price)
  const overLimit = target != null && minPrice != null && target < minPrice
  const step = (d: number) => onChange({ qty: fmtQty(Math.max(d < 0 ? 1 : 0, Math.round((qty + d) * 1000) / 1000)) })
  return (
    <View className="gap-3 p-4">
      <Text className="text-sm font-medium text-foreground">
        <Text className="font-mono text-xs text-foreground-muted">{index + 1}  </Text>
        {item.description}
      </Text>
      <View>
        <Label>Quantity ({item.unit})</Label>
        <Stepper
          value={line.qty}
          onChangeText={raw => onChange({ qty: cleanDecimal(raw) })}
          onDecrement={() => step(-1)}
          onIncrement={() => step(1)}
          canDecrement={qty > 1}
          decimal
          width={64}
          itemName={item.description}
        />
      </View>
      <TextField
        label="Target Price (₹)"
        value={line.price}
        onChangeText={raw => onChange({ price: cleanDecimal(raw) })}
        keyboardType="decimal-pad"
        prefix="₹"
        placeholder="Optional"
        error={overLimit ? `Maximum discount is ${MAX_DISCOUNT_PCT}% — minimum target price is ₹${inr(minPrice)}` : null}
        helper={`Max ${MAX_DISCOUNT_PCT}% discount off listed price`}
      />
      <TextField label="Item Notes" value={line.notes} onChangeText={notes => onChange({ notes })} placeholder="Optional" />
    </View>
  )
}

function Bubble({ msg, items, adminBadge }: { msg: RfqMessage; items: Item[]; adminBadge: string }) {
  const isAdmin = msg.sender === 'admin'
  const counter = counterOf(msg)
  return (
    <View className={cn('flex-row gap-2', !isAdmin && 'flex-row-reverse')}>
      <View className={cn('h-7 w-7 items-center justify-center rounded-full', isAdmin ? 'bg-accent-500' : 'bg-zinc-600')}>
        <Text className="text-[10px] font-bold text-white">{isAdmin ? adminBadge : 'Me'}</Text>
      </View>
      <View className={cn('max-w-[80%] flex-1 gap-1.5', !isAdmin && 'items-end')}>
        <View className={cn('rounded-2xl px-4 py-2.5', isAdmin ? 'rounded-tl-none border border-border-default bg-surface' : 'rounded-tr-none bg-accent-500')}>
          <Text selectable className={cn('text-sm leading-5', isAdmin ? 'text-foreground' : 'text-white')}>
            {msg.message}
          </Text>
        </View>
        {!!counter?.length && (
          <View className="w-full gap-1.5 rounded-xl border border-purple-200 bg-purple-50 p-3 dark:border-purple-800 dark:bg-purple-900/20">
            <Text className="text-[11px] font-semibold uppercase tracking-wide text-purple-600 dark:text-purple-400">Offered Prices</Text>
            {counter.map(ci => (
              <View key={ci.rfq_item_id} className="flex-row items-center justify-between gap-3">
                <Text numberOfLines={1} className="flex-1 text-xs text-foreground-secondary">
                  {items.find(it => it.id === ci.rfq_item_id)?.description || ci.rfq_item_id}
                </Text>
                <Text className="text-xs font-semibold text-purple-600 dark:text-purple-400">₹{inr(ci.offered_price)}</Text>
              </View>
            ))}
          </View>
        )}
        <Caption className="px-1">{sentAt(new Date(msg.created_at))}</Caption>
      </View>
    </View>
  )
}

function OfferCard({
  offer,
  items,
  discountMap,
  busy,
  onAccept,
  onCounter,
}: {
  offer: CounterItem[]
  items: Item[]
  discountMap: Record<string, number>
  busy: 'accept' | 'decline' | null
  onAccept: () => void
  onCounter: (prices: Record<string, string>, message: string) => void
}) {
  const [countering, setCountering] = useState(false)
  const [prices, setPrices] = useState<Record<string, string>>({})
  const [reply, setReply] = useState('')
  const nameOf = (id: string) => items.find(it => it.id === id)?.description || 'Item'
  return (
    <View className="gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 dark:border-amber-700 dark:bg-amber-900/20">
      <View className="flex-row items-center gap-2">
        <TintedIcon icon={ClipboardCheck} size={16} className="text-amber-600 dark:text-amber-400" />
        <Text className="text-sm font-semibold text-amber-700 dark:text-amber-400">You have a pending offer</Text>
      </View>
      {!countering ? (
        <>
          <View className="gap-1.5">
            {offer.map(ci => {
              const item = items.find(it => it.id === ci.rfq_item_id)
              const saving = item ? pctOff(ci.offered_price, pricing(item, discountMap).shown) : null
              return (
                <View key={ci.rfq_item_id} className="flex-row items-center justify-between gap-3 rounded-lg bg-surface-elevated px-3 py-2">
                  <Text numberOfLines={1} className="flex-1 text-xs text-foreground-secondary">
                    {nameOf(ci.rfq_item_id)}
                  </Text>
                  {saving != null && saving > 0 && <Badge label={`${saving}% off`} tone="success" size="sm" />}
                  <Text className="text-sm font-bold text-foreground">₹{inr(ci.offered_price)}</Text>
                </View>
              )
            })}
          </View>
          <View className="flex-row gap-2">
            <Button label="Accept Offer" icon={Check} size="md" className="flex-1" loading={busy === 'accept'} disabled={busy != null} onPress={onAccept} />
            <Button
              label="Negotiate"
              icon={MessageSquare}
              variant="outline"
              size="md"
              className="flex-1"
              disabled={busy != null}
              onPress={() => {
                setPrices(Object.fromEntries(offer.map(ci => [ci.rfq_item_id, String(ci.offered_price)])))
                setCountering(true)
              }}
            />
          </View>
        </>
      ) : (
        <View className="gap-3">
          <Overline>Your counter prices</Overline>
          {offer.map(ci => (
            <View key={ci.rfq_item_id} className="flex-row items-center justify-between gap-3 rounded-lg border border-border-secondary bg-surface-elevated px-3 py-2">
              <View className="flex-1">
                <Text numberOfLines={1} className="text-xs text-foreground-secondary">
                  {nameOf(ci.rfq_item_id)}
                </Text>
                <Text className="text-[10px] text-foreground-muted">Admin offered ₹{inr(ci.offered_price)}</Text>
              </View>
              <Text className="text-xs text-foreground-secondary">₹</Text>
              <Stepper value={prices[ci.rfq_item_id] ?? ''} onChangeText={raw => setPrices(p => ({ ...p, [ci.rfq_item_id]: cleanDecimal(raw) }))} decimal width={84} />
            </View>
          ))}
          <TextField value={reply} onChangeText={setReply} multiline placeholder="Explain your counter offer or ask a question…" />
          <View className="flex-row gap-2">
            <Button label="Send Counter Offer" size="md" className="flex-1" loading={busy === 'decline'} disabled={busy != null} onPress={() => onCounter(prices, reply)} />
            <Button
              label="Cancel"
              variant="outline"
              size="md"
              block={false}
              disabled={busy != null}
              onPress={() => {
                setCountering(false)
                setReply('')
                setPrices({})
              }}
            />
          </View>
        </View>
      )}
    </View>
  )
}

function OrderCard({ order, slug }: { order: RfqOrder; slug: string | null }) {
  const router = useRouter()
  const paid = order.payment_status === 'paid'
  const payable = !paid && order.payment_status !== 'cod_collected' && order.status !== 'cancelled'
  return (
    <Card className="gap-3">
      <View>
        <Overline>Invoice / Order</Overline>
        <Text className="mt-0.5 font-mono text-sm font-semibold text-foreground">{order.invoice_number || order.order_number}</Text>
      </View>
      <View className="flex-row items-center justify-between gap-2">
        <Caption>Payment</Caption>
        <Badge label={paid ? 'Paid' : 'Awaiting Payment'} tone={paid ? 'success' : 'warning'} size="sm" />
      </View>
      <View className="flex-row items-center justify-between gap-2">
        <Caption>Total</Caption>
        <Text className="text-sm font-bold text-foreground">₹{rupees0(Number(order.total_amount))}</Text>
      </View>
      {paid && (
        <View className="flex-row items-center gap-2">
          <TintedIcon icon={CheckCircle2} size={16} className="text-green-600 dark:text-green-400" />
          <Text className="text-xs font-medium text-green-600 dark:text-green-400">Payment received. Thank you!</Text>
        </View>
      )}
      {payable ? (
        <Button label="Pay now" icon={CreditCard} size="md" onPress={() => router.push(`/orders/${order.id}`)} />
      ) : (
        <Button label="View Order" variant="outline" size="md" onPress={() => router.push(`/orders/${order.id}`)} />
      )}
      {!!order.view_token && (
        <Button label="View Invoice" icon={ExternalLink} variant="secondary" size="md" onPress={() => Linking.openURL(invoiceUrl(slug, order.view_token!))} />
      )}
    </Card>
  )
}

function StatusTimeline({ status }: { status: RfqStatus }) {
  const rejected = status === 'rejected'
  const steps: RfqStatus[] = rejected ? [...STEPS, 'rejected'] : STEPS
  const current = ORDER.indexOf(status)
  return (
    <Card>
      <Overline className="mb-3">Status</Overline>
      {steps.map((s, i) => {
        const done = rejected ? false : current >= ORDER.indexOf(s)
        const active = status === s
        const dot = s === 'rejected' ? 'border-red-500 bg-red-500' : active ? 'border-accent-500 bg-accent-500' : done ? 'border-green-500 bg-green-500' : 'border-border-secondary bg-surface'
        const label =
          s === 'rejected' ? 'text-red-600 dark:text-red-400' : active ? 'text-accent-600 dark:text-accent-400' : done ? 'text-green-600 dark:text-green-400' : 'text-foreground-muted'
        return (
          <View key={s} className="flex-row gap-3" accessibilityLabel={`${RFQ_STATUS_LABEL[s]}${active ? ', current' : done ? ', done' : ''}`}>
            <View className="items-center" style={{ width: 12 }}>
              <View className={cn('h-3 w-3 rounded-full border-2', dot)} />
              {i < steps.length - 1 && <View className="w-px flex-1 bg-border-default" style={{ minHeight: 14 }} />}
            </View>
            <Text className={cn('-mt-0.5 pb-3 text-xs font-medium', label)}>{RFQ_STATUS_LABEL[s]}</Text>
          </View>
        )
      })}
    </Card>
  )
}

export default function QuoteDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const router = useRouter()
  const qc = useQueryClient()
  const { ready } = useRequireBusiness()
  const config = useStoreConfig()
  const slug = config.slug

  const rfqQ = useQuery({ queryKey: ['rfq', id], queryFn: () => getRfq(id), enabled: ready && !!id, retry: 0 })
  // The web treats a failed thread load as empty.
  const msgQ = useQuery({ queryKey: ['rfq-messages', id], queryFn: () => getRfqMessages(id).catch(() => [] as RfqMessage[]), enabled: ready && !!id })
  const [refreshing, setRefreshing] = useState(false)

  const [editing, setEditing] = useState(false)
  const [editLines, setEditLines] = useState<Record<string, EditLine>>({})
  const [editNotes, setEditNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')

  const [msgText, setMsgText] = useState('')
  const [sendingMsg, setSendingMsg] = useState(false)
  const [msgError, setMsgError] = useState('')
  const [responding, setResponding] = useState<'accept' | 'decline' | null>(null)

  const [resubmitNotes, setResubmitNotes] = useState('')
  const [resubmitting, setResubmitting] = useState(false)
  const [resubmitError, setResubmitError] = useState('')

  const reload = () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: ['rfq', id] }),
      qc.invalidateQueries({ queryKey: ['rfq-messages', id] }),
      qc.invalidateQueries({ queryKey: ['rfqs'] }),
    ])

  const onRefresh = async () => {
    setRefreshing(true)
    await Promise.all([rfqQ.refetch(), msgQ.refetch()]).catch(() => {})
    setRefreshing(false)
  }

  if (!ready || rfqQ.isLoading) return <Screen title={TITLE} loading skeleton={<DetailLoading />} />

  const data: RfqDetail | undefined = rfqQ.data
  if (rfqQ.isError || !data?.rfq) {
    return (
      <Screen title={TITLE} onRefresh={onRefresh} refreshing={refreshing}>
        <EmptyState
          fill
          icon={FileText}
          title="Quote not found."
          message={(rfqQ.error as Error)?.message && (rfqQ.error as Error).message !== 'Not found' ? (rfqQ.error as Error).message : undefined}
          actionLabel="Back to My Quotes"
          onAction={() => router.replace('/account/quotes')}
        />
      </Screen>
    )
  }

  const { rfq, order } = data
  const items = data.items as Item[]
  const discountMap = data.discountMap || {}
  const messages = msgQ.data ?? []

  const canEdit = EDITABLE.includes(rfq.status)
  const canMessage = !['converted', 'rejected', 'offer_accepted'].includes(rfq.status)
  const latestCounter = [...messages].reverse().find(m => m.sender === 'admin' && !!counterOf(m)?.length)
  const latestCustomerCounter = [...messages].reverse().find(m => m.sender === 'customer' && !!counterOf(m)?.length)
  // Once the customer counters back the ball is in our court, so the offer card hides.
  const pendingAdminOffer =
    !!latestCounter && (!latestCustomerCounter || new Date(latestCounter.created_at).getTime() > new Date(latestCustomerCounter.created_at).getTime())
  const counterMap = Object.fromEntries((latestCounter ? counterOf(latestCounter)! : []).map(ci => [ci.rfq_item_id, ci.offered_price]))
  const customerCounterMap = Object.fromEntries((latestCustomerCounter ? counterOf(latestCustomerCounter)! : []).map(ci => [ci.rfq_item_id, ci.offered_price]))
  const isFinalState = rfq.status === 'offer_accepted' || rfq.status === 'converted'
  // Final: the quotation's price; else the customer's latest counter, else the requested price.
  const targetFor = (item: Item): number | null => {
    if (isFinalState && item.quoted_rate != null) return quotedPrice(item)
    if (!isFinalState && customerCounterMap[item.id] != null) return Number(customerCounterMap[item.id])
    return item.requested_price != null ? Number(item.requested_price) : null
  }
  const totalRequested = items.reduce((sum, i) => {
    const t = targetFor(i)
    return sum + (t != null ? t * Number(i.quantity) : 0)
  }, 0)
  const minPriceOf = (item: Item) => {
    const shown = pricing(item, discountMap).shown
    return shown && shown > 0 ? applyDiscount(shown, MAX_DISCOUNT_PCT) : null
  }

  const startEdit = () => {
    setEditLines(Object.fromEntries(items.map(i => [i.id, { qty: fmtQty(Number(i.quantity)), price: i.requested_price != null ? String(Number(i.requested_price)) : '', notes: i.notes || '' }])))
    setEditNotes(rfq.notes || '')
    setSaveError('')
    setEditing(true)
  }

  const overLimit = editing && items.some(i => {
    const p = parseAmount(editLines[i.id]?.price ?? '')
    const min = minPriceOf(i)
    return p != null && min != null && p < min
  })

  const handleSave = async () => {
    if (overLimit) return setSaveError(`Target price exceeds the ${MAX_DISCOUNT_PCT}% discount limit — please adjust before saving.`)
    setSaving(true)
    setSaveError('')
    try {
      await updateRfq(id, {
        notes: editNotes,
        items: items.map(i => {
          const l = editLines[i.id]
          const q = parseFloat(l?.qty ?? '')
          return {
            id: i.id,
            quantity: Number.isFinite(q) && q > 0 ? q : undefined,
            requested_price: parseAmount(l?.price ?? ''),
            notes: l?.notes || null,
          }
        }),
      })
      setEditing(false)
      toast.success('Changes saved successfully.')
      await reload()
    } catch (err) {
      setSaveError(errMsg(err, 'Failed to save'))
    } finally {
      setSaving(false)
    }
  }

  const handleSendMessage = async () => {
    if (!msgText.trim()) return
    setSendingMsg(true)
    setMsgError('')
    try {
      const { message } = await sendRfqMessage(id, { message: msgText.trim() })
      qc.setQueryData<RfqMessage[]>(['rfq-messages', id], prev => [...(prev ?? []), message])
      setMsgText('')
      if (rfq.status === 'pending' || rfq.status === 'reviewed') {
        qc.invalidateQueries({ queryKey: ['rfq', id] })
        qc.invalidateQueries({ queryKey: ['rfqs'] })
      }
    } catch (err) {
      setMsgError(errMsg(err, 'Failed to send'))
    } finally {
      setSendingMsg(false)
    }
  }

  const handleRespond = async (action: 'accept' | 'decline', prices?: Record<string, string>, reply?: string) => {
    if (action === 'accept') {
      const ok = await confirm({ title: 'Accept this offer?', message: 'Our team will prepare your quotation at the offered prices.', confirmLabel: 'Accept Offer' })
      if (!ok) return
    }
    setResponding(action)
    setMsgError('')
    try {
      const counter_items =
        action === 'decline'
          ? Object.entries(prices ?? {})
              .map(([rfq_item_id, raw]) => ({ rfq_item_id, offered_price: parseAmount(raw) ?? NaN }))
              .filter(c => Number.isFinite(c.offered_price) && c.offered_price >= 0)
          : undefined
      await respondToOffer(id, {
        action,
        message: action === 'decline' ? reply?.trim() || undefined : undefined,
        ...(counter_items?.length ? { counter_items } : {}),
      })
      await reload()
    } catch (err) {
      setMsgError(errMsg(err, 'Failed to respond'))
    } finally {
      setResponding(null)
    }
  }

  const handleResubmit = async () => {
    setResubmitError('')
    setResubmitting(true)
    try {
      const d = await resubmitRfq(id, resubmitNotes.trim() || undefined)
      qc.invalidateQueries({ queryKey: ['rfqs'] })
      if (d?.rfq?.id) router.replace(`/account/quotes/${d.rfq.id}`)
    } catch (err) {
      setResubmitError(errMsg(err, 'Failed to resubmit'))
    } finally {
      setResubmitting(false)
    }
  }

  const rejected = rfq.status === 'rejected'

  return (
    <Screen
      title={TITLE}
      mode="keyboard"
      refreshing={refreshing}
      onRefresh={editing ? undefined : onRefresh}
      footer={
        editing ? (
          <View className="gap-2">
            {saveError ? <FieldError message={saveError} /> : <Caption>Review your changes before saving</Caption>}
            <View className="flex-row gap-3">
              <Button
                label="Cancel"
                variant="outline"
                className="flex-1"
                disabled={saving}
                onPress={() => {
                  setEditing(false)
                  setSaveError('')
                }}
              />
              <Button label="Save Changes" loadingLabel="Saving…" className="flex-1" loading={saving} onPress={handleSave} />
            </View>
          </View>
        ) : undefined
      }
    >
      <View className="gap-4">
        <Card className="gap-3">
          <View>
            <View className="flex-row flex-wrap items-center gap-2">
              <Text selectable className="font-mono text-lg font-bold text-foreground">
                {rfq.rfq_number}
              </Text>
              <Badge label={RFQ_STATUS_LABEL[rfq.status] || rfq.status} tone={rfqTone(rfq.status)} />
            </View>
            <Caption className="mt-1">Submitted {submittedOn(new Date(rfq.created_at))}</Caption>
          </View>
          {rfq.status === 'converted' && !!rfq.quotation_view_token && (
            <Button
              label={`View Quotation${rfq.quote_number ? ` (${rfq.quote_number})` : ''}`}
              icon={ExternalLink}
              variant="outline"
              size="md"
              onPress={() => Linking.openURL(quotationUrl(slug, rfq.quotation_view_token!))}
            />
          )}
          {!!rfq.admin_note && (
            <Notice tone={rejected ? 'danger' : 'info'} title={rejected ? 'Reason for rejection:' : 'Note from our team:'}>
              {rfq.admin_note}
            </Notice>
          )}
          {rejected && (
            <Notice tone="warning" title="Need to revise and try again?">
              <View className="mt-1 gap-3">
                <Text className="text-sm leading-5 text-orange-800 dark:text-orange-300">
                  You can submit a new quote request with the same items. Our team will review it as a fresh ticket.
                </Text>
                <TextField value={resubmitNotes} onChangeText={setResubmitNotes} multiline placeholder="Optional: any updated context or reason for the resubmission..." />
                <FieldError message={resubmitError} />
                <Button label="Request New Quote" loadingLabel="Submitting…" size="md" loading={resubmitting} onPress={handleResubmit} />
              </View>
            </Notice>
          )}
        </Card>

        {order && <OrderCard order={order} slug={slug} />}

        <Card padded={false}>
          <View className="flex-row items-center justify-between px-4 py-3">
            <Overline>Requested Items</Overline>
            {canEdit && !editing && <Button label="Edit Request" icon={Pencil} variant="outline" size="sm" block={false} onPress={startEdit} />}
          </View>
          <Divider />
          {items.map((item, i) => (
            <View key={item.id}>
              {i > 0 && <Divider />}
              {editing ? (
                <EditRow
                  item={item}
                  index={i}
                  line={editLines[item.id] ?? { qty: '', price: '', notes: '' }}
                  minPrice={minPriceOf(item)}
                  onChange={patch => setEditLines(prev => ({ ...prev, [item.id]: { ...prev[item.id], ...patch } }))}
                />
              ) : (
                <ItemRow item={item} index={i} discountMap={discountMap} offered={counterMap[item.id]} target={targetFor(item)} />
              )}
            </View>
          ))}
          {!editing && totalRequested > 0 && (
            <>
              <Divider />
              <View className="flex-row items-center justify-between px-4 py-3">
                <Text className="text-sm font-semibold text-foreground-secondary">Total Target Value</Text>
                <Text className="font-bold text-foreground">₹{inr(totalRequested)}</Text>
              </View>
            </>
          )}
        </Card>

        {editing && (
          <Card>
            <TextField label="Overall Notes" value={editNotes} onChangeText={setEditNotes} multiline placeholder="Any additional notes…" />
          </Card>
        )}

        {!editing && !msgQ.isLoading && (messages.length > 0 || canMessage || rfq.status === 'offer_accepted') && (
          <Card className="gap-3">
            <Overline>Messages</Overline>
            {messages.map(m => (
              <Bubble key={m.id} msg={m} items={items} adminBadge={initials(config.identity.name || 'Jeffi Stores')} />
            ))}
            {messages.length === 0 && rfq.status !== 'offer_accepted' && <BodySmall className="py-3 text-center">No messages yet.</BodySmall>}
            {rfq.status === 'offer_accepted' && (
              <Notice tone="success" icon={Check} title="Offer accepted">
                Our team is preparing your quotation. You’ll be notified once it’s ready.
              </Notice>
            )}
            {canMessage && (
              <View className="gap-3 border-t border-border-default pt-3">
                <FieldError message={msgError} />
                {pendingAdminOffer && latestCounter ? (
                  <OfferCard
                    key={latestCounter.id}
                    offer={counterOf(latestCounter)!}
                    items={items}
                    discountMap={discountMap}
                    busy={responding}
                    onAccept={() => handleRespond('accept')}
                    onCounter={(prices, reply) => handleRespond('decline', prices, reply)}
                  />
                ) : (
                  <>
                    <BodySmall className="text-center">Awaiting a response from our team.</BodySmall>
                    <TextField value={msgText} onChangeText={setMsgText} multiline placeholder="Write a message to our team…" />
                    <Button label="Send Message" icon={Send} size="md" loading={sendingMsg} disabled={!msgText.trim()} onPress={handleSendMessage} />
                  </>
                )}
              </View>
            )}
          </Card>
        )}

        {!editing && !!rfq.notes && (
          <Card>
            <Overline className="mb-2">Your Notes</Overline>
            <Text selectable className="text-sm leading-5 text-foreground">
              {rfq.notes}
            </Text>
          </Card>
        )}

        <StatusTimeline status={rfq.status} />
      </View>
    </Screen>
  )
}
