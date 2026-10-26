import { memo, useMemo, useState } from 'react'
import { FlatList, Linking, View } from 'react-native'
import { useRouter } from 'expo-router'
import { Ban, Clock, ClipboardList, ExternalLink, FilePlus, FileText } from 'lucide-react-native'
import { listRfqs, type Rfq, type RfqStatus } from '../../../src/api/business'
import { useInfiniteList } from '../../../src/components/account/hooks'
import { InfiniteFooter } from '../../../src/components/account/ui'
import { invoiceUrl } from '../../../src/components/orders/shared'
import { paymentLabel, paymentTone, quotationUrl, RFQ_STATUS_SHORT, RFQ_STATUSES, rfqTone, rupees0, useRequireBusiness } from '../../../src/components/business/rfq'
import { useStoreConfig } from '../../../src/hooks/useStoreConfig'
import { dateFormat } from '../../../src/lib/format'
import { Badge, BodySmall, Button, Caption, Card, Chip, ChipGroup, EmptyState, IconButton, Screen, ScreenHeader, Skeleton, Text, useBottomInset } from '../../../src/ui'

// Mirror of controller-service app/(business)/business/quotes/page.tsx.

const STATUS_MSG: Record<RfqStatus, string> = {
  pending: 'Awaiting review by our team',
  reviewed: 'Under review — quotation being prepared',
  negotiating: 'Negotiating — check messages for updates',
  offer_accepted: 'Offer accepted — quotation being prepared',
  converted: 'Quotation issued',
  rejected: 'Not accepted — contact support for details',
}

const submitted = dateFormat({ day: 'numeric', month: 'short', year: 'numeric' })
const Gap = () => <View style={{ height: 12 }} />

// Status chips, then RFQ cards: number + badges, amount, meta, actions.
function QuotesLoading() {
  return (
    <View className="pt-4">
      <View className="mb-4 flex-row gap-2 overflow-hidden px-4">
        {[52, 84, 92, 110, 96].map((w, i) => (
          <Skeleton key={i} width={w} height={38} rounded="rounded-full" />
        ))}
      </View>
      <View className="gap-3 px-4">
        {[0, 1, 2, 3].map(i => (
          <View key={i} className="rounded-panel bg-surface-elevated p-4 dark:border dark:border-border-default">
            <View className="flex-row items-start justify-between">
              <View className="gap-2">
                <Skeleton height={14} width={150} />
                <Skeleton height={20} width={72} rounded="rounded-full" />
              </View>
              <Skeleton height={28} width={80} />
            </View>
            <Skeleton height={12} width={140} className="mt-3" />
            <Skeleton height={10} width={180} rounded="rounded" className="mt-2" />
            <Skeleton height={36} width={130} rounded="rounded-xl" className="mt-3" />
          </View>
        ))}
      </View>
    </View>
  )
}

const RfqCard = memo(function RfqCard({ rfq, slug }: { rfq: Rfq; slug: string | null }) {
  const router = useRouter()
  const displayTotal = rfq.quotation_total ? Number(rfq.quotation_total) : rfq.requested_total ? Number(rfq.requested_total) : null
  const amount =
    rfq.order_id && rfq.invoice_total
      ? { label: 'Invoice total', value: Number(rfq.invoice_total) }
      : displayTotal != null && displayTotal > 0
        ? { label: rfq.quotation_total ? 'Quoted value' : 'Requested value', value: displayTotal }
        : null
  const showQuotation = rfq.status === 'converted' && !!rfq.quotation_view_token
  const showInvoice = !!rfq.order_id && !!rfq.invoice_view_token && rfq.order_status !== 'draft'
  const progress = !rfq.order_id
    ? rfq.status === 'pending'
      ? { label: 'Pending review', tone: 'warning' as const, icon: Clock }
      : rfq.status === 'reviewed'
        ? { label: 'In progress', tone: 'info' as const, icon: ClipboardList }
        : rfq.status === 'rejected'
          ? { label: 'Not accepted', tone: 'danger' as const, icon: Ban }
          : null
    : null

  return (
    <Card className="gap-1" wrapperClassName="mx-4" accessibilityLabel={`Quote ${rfq.rfq_number}`} onPress={() => router.push(`/account/quotes/${rfq.id}`)}>
      <View className="mb-1 flex-row items-start justify-between gap-3">
        <View className="flex-1 gap-1.5">
          <Text className="font-mono text-sm font-semibold text-foreground">{rfq.rfq_number}</Text>
          <View className="flex-row flex-wrap gap-1.5">
            <Badge label={RFQ_STATUS_SHORT[rfq.status] ?? rfq.status} tone={rfqTone(rfq.status)} size="sm" />
            {!!rfq.order_id && !!rfq.payment_status && <Badge label={paymentLabel(rfq.payment_status)} tone={paymentTone(rfq.payment_status)} size="sm" />}
          </View>
        </View>
        {amount && (
          <View className="items-end">
            <Caption>{amount.label}</Caption>
            <Text className="text-base font-bold text-foreground">₹{rupees0(amount.value)}</Text>
          </View>
        )}
      </View>
      <BodySmall>
        {rfq.item_count} item{rfq.item_count !== 1 ? 's' : ''} · {submitted(new Date(rfq.created_at))}
      </BodySmall>
      {!!rfq.notes && <Caption numberOfLines={1}>{rfq.notes}</Caption>}
      <Caption className="italic">{STATUS_MSG[rfq.status] ?? ''}</Caption>
      {(showQuotation || showInvoice || progress) && (
        <View className="mt-2 flex-row flex-wrap gap-2">
          {showQuotation && (
            <Button
              label={`View Quotation${rfq.quote_number ? ` (${rfq.quote_number})` : ''}`}
              icon={ExternalLink}
              variant="outline"
              size="sm"
              block={false}
              onPress={() => Linking.openURL(quotationUrl(slug, rfq.quotation_view_token!))}
            />
          )}
          {showInvoice && (
            <Button
              label={`View Invoice${rfq.invoice_number ? ` (${rfq.invoice_number})` : ''}`}
              icon={ExternalLink}
              size="sm"
              block={false}
              onPress={() => Linking.openURL(invoiceUrl(slug, rfq.invoice_view_token!))}
            />
          )}
          {progress && <Badge label={progress.label} tone={progress.tone} icon={progress.icon} />}
        </View>
      )}
    </Card>
  )
})

export default function QuotesScreen() {
  const bottom = useBottomInset()
  const router = useRouter()
  const { ready, user } = useRequireBusiness()
  const slug = useStoreConfig().slug
  const [filterStatus, setFilterStatus] = useState<'all' | RfqStatus>('all')
  const [refreshing, setRefreshing] = useState(false)

  const list = useInfiniteList<Rfq>({
    key: ['rfqs', user?.id ?? null],
    enabled: ready,
    pageSize: 20,
    fetchPage: async p => {
      const d = await listRfqs(p)
      return { rows: d.rfqs || [], total: d.total ?? null }
    },
  })
  const rfqs = list.rows
  const filtered = useMemo(() => (filterStatus === 'all' ? rfqs : rfqs.filter(r => r.status === filterStatus)), [rfqs, filterStatus])

  const header = (
    <ScreenHeader
      title="My Quotes"
      actions={<IconButton icon={FilePlus} label="New quote request" onPress={() => router.push('/account/quotes/new')} />}
    />
  )

  return (
    <Screen header={header} mode="none" loading={!ready || list.loading} skeleton={<QuotesLoading />}>
      <FlatList
        data={filtered}
        keyExtractor={r => r.id}
        onEndReached={list.loadMore}
        onEndReachedThreshold={0.5}
        refreshing={refreshing}
        onRefresh={async () => {
          setRefreshing(true)
          await list.reload().catch(() => {})
          setRefreshing(false)
        }}
        contentContainerStyle={{ paddingBottom: bottom }}
        ItemSeparatorComponent={Gap}
        ListHeaderComponent={
          rfqs.length > 0 ? (
            <ChipGroup scroll className="mb-4 pt-4">
              {(['all', ...RFQ_STATUSES] as const).map(s => (
                <Chip key={s} label={s === 'all' ? 'All' : RFQ_STATUS_SHORT[s]} selected={filterStatus === s} onPress={() => setFilterStatus(s)} />
              ))}
            </ChipGroup>
          ) : null
        }
        ListEmptyComponent={
          rfqs.length === 0 ? (
            <EmptyState icon={FileText} title="No quote requests yet" message="Use the “Request Quote” button on any product page or cart to get started.">
              <View className="mt-5 w-full max-w-[260px] gap-2">
                <Button label="New Quote Request" size="md" onPress={() => router.push('/account/quotes/new')} />
                <Button label="Browse Products" variant="ghost" size="md" onPress={() => router.navigate('/(tabs)/products')} />
              </View>
            </EmptyState>
          ) : (
            <BodySmall className="py-8 text-center">No quotes with this status{list.hasMore ? ' yet — load more to see older quotes' : ''}.</BodySmall>
          )
        }
        renderItem={({ item }) => <RfqCard rfq={item} slug={slug} />}
        ListFooterComponent={
          <View className="px-4">
            <InfiniteFooter shown={rfqs.length} list={list} noun="quotes" />
          </View>
        }
      />
    </Screen>
  )
}
