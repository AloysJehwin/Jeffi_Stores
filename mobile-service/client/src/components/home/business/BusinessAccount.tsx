import { Linking, View } from 'react-native'
import { useRouter } from 'expo-router'
import { Building2, FileText, Mail, Phone, ShoppingBag, Wallet } from 'lucide-react-native'
import { Badge, Button, Caption, Card, ListGroup, ListRow, Overline, Text, TextButton, TintedIcon, statusTone, type IconComponent } from '../../../ui'
import { SectionHeading } from '../layout'
import { orderStatusLabel } from '../../account/ui'
import { useBusiness } from '../../account/hooks'
import { dateFormat, inr } from '../../../lib/format'
import { businessSettings, useBusinessHome } from './useBusinessHome'
import type { SectionProps } from '../../../types/home'

// Company, payments due and open quotes, recent orders, and the business's sales contact.

const COPY = { eyebrow: 'Your account', title: 'Account at a glance' }

const placed = dateFormat({ day: 'numeric', month: 'short' })

function Stat({ icon, label, value, sub, onPress }: { icon: IconComponent; label: string; value: string; sub?: string; onPress: () => void }) {
  return (
    <Card wrapperClassName="flex-1" className="gap-2" accessibilityLabel={`${label}, ${value}${sub ? `, ${sub}` : ''}`} onPress={onPress}>
      <View className="h-9 w-9 items-center justify-center rounded-xl bg-accent-50 dark:bg-accent-900/30">
        <TintedIcon icon={icon} size={18} className="text-accent-600 dark:text-accent-400" />
      </View>
      <Caption>{label}</Caption>
      <Text className="text-xl font-extrabold text-foreground">{value}</Text>
      {sub ? <Caption>{sub}</Caption> : null}
    </Card>
  )
}

export default function BusinessAccount({ section, data }: SectionProps) {
  const router = useRouter()
  const { profile } = useBusiness()
  const { data: home } = useBusinessHome(section, data)
  if (!home) return null
  const settings = businessSettings(section, data)?.account
  const tiles = settings?.tiles ?? ['orders', 'payments', 'quotes']
  const contact = settings?.contact ?? null
  const company = home.company.name || profile?.companyName || null
  const gst = home.company.gstNumber || profile?.gstNumber || null
  const due = home.account?.paymentsDue
  const orders = home.account?.recentOrders ?? []
  const stats = [
    tiles.includes('payments') && due && (
      <Stat
        key="payments"
        icon={Wallet}
        label="Payments due"
        value={`₹${inr(due.total)}`}
        sub={`${due.count} order${due.count !== 1 ? 's' : ''}`}
        onPress={() => router.push('/orders')}
      />
    ),
    tiles.includes('quotes') && home.quotes && (
      <Stat key="quotes" icon={FileText} label="Open quotes" value={String(home.quotes.open)} onPress={() => router.push('/account/quotes')} />
    ),
  ].filter(Boolean)

  return (
    <View className="bg-surface-secondary px-4 py-12">
      <SectionHeading eyebrow={section.copy.eyebrow ?? COPY.eyebrow} title={section.copy.title || COPY.title} />
      <View className="gap-4">
        {company || gst ? (
          <Card className="flex-row items-center gap-3">
            <View className="h-11 w-11 items-center justify-center rounded-xl bg-primary-50 dark:bg-primary-900/30">
              <TintedIcon icon={Building2} size={22} className="text-primary-600 dark:text-primary-300" />
            </View>
            <View className="flex-1">
              {company ? <Text numberOfLines={2} className="text-base font-bold text-foreground">{company}</Text> : null}
              {gst ? <Caption className="mt-0.5 font-mono">GSTIN {gst}</Caption> : null}
            </View>
          </Card>
        ) : null}

        {stats.length > 0 && <View className="flex-row gap-3">{stats}</View>}

        {tiles.includes('orders') && orders.length > 0 && (
          <View>
            <View className="mb-2 flex-row items-center justify-between px-1">
              <Overline>Recent orders</Overline>
              <TextButton label="View all" onPress={() => router.push('/orders')} />
            </View>
            <ListGroup>
              {orders.map(o => (
                <ListRow
                  key={o.id}
                  icon={ShoppingBag}
                  title={o.orderNumber}
                  subtitle={`${placed(new Date(o.createdAt))} · ₹${inr(o.total)}`}
                  trailing={<Badge label={orderStatusLabel(o.status)} tone={statusTone(o.status)} size="sm" />}
                  onPress={() => router.push(`/orders/${o.id}`)}
                />
              ))}
            </ListGroup>
          </View>
        )}

        {contact && (
          <Card className="gap-3">
            <View>
              <Caption>Your sales contact</Caption>
              {contact.name ? <Text className="mt-0.5 text-base font-bold text-foreground">{contact.name}</Text> : null}
            </View>
            <View className="flex-row flex-wrap gap-2">
              {contact.phone ? (
                <Button label="Call" icon={Phone} size="sm" block={false} onPress={() => Linking.openURL(`tel:${contact.phone!.replace(/[^\d+]/g, '')}`)} />
              ) : null}
              {contact.email ? (
                <Button label="Email" icon={Mail} variant="outline" size="sm" block={false} onPress={() => Linking.openURL(`mailto:${contact.email}`)} />
              ) : null}
            </View>
            {contact.phone || contact.email ? <Caption selectable>{[contact.phone, contact.email].filter(Boolean).join(' · ')}</Caption> : null}
          </Card>
        )}
      </View>
    </View>
  )
}
