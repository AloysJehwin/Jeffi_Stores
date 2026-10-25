import { BadgePercent, Bell, Package, ShieldCheck, TrendingDown } from 'lucide-react-native'
import type { NotificationCategory } from '../../api/notifications'
import type { IconComponent } from '../../ui'

// Labels match the Android channel names in lib/push.ts.
export const CATEGORY_META: Record<NotificationCategory, { label: string; description: string; icon: IconComponent }> = {
  orders: { label: 'Order updates', description: 'Confirmed, shipped, out for delivery, delivered, refunds and returns.', icon: Package },
  account: { label: 'Account', description: 'Payments, subscriptions, quotes and account alerts.', icon: ShieldCheck },
  offers: { label: 'Offers', description: 'Deals, coupons and new arrivals.', icon: BadgePercent },
  price_alerts: { label: 'Price alerts', description: 'Price drops and back in stock on your wishlist.', icon: TrendingDown },
}

export const categoryIcon = (c: string | null | undefined): IconComponent =>
  (c && c in CATEGORY_META ? CATEGORY_META[c as NotificationCategory].icon : Bell)
