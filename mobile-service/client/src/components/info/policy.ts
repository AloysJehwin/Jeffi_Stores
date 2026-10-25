import { Linking } from 'react-native'
import { Archive, BadgeCheck, CircleHelp, CircleX, FileText, Phone, ShieldCheck, Undo2 } from 'lucide-react-native'
import type { IconComponent } from '../../ui'
import { absUrl } from '../../lib/links'

// The /legal page's per-policy icons and the PDF download.

export const POLICY_ICONS: Record<string, IconComponent> = {
  'privacy-policy': ShieldCheck,
  'terms-and-conditions': FileText,
  'return-refund-policy': Undo2,
  'shipping-policy': Archive,
  'cancellation-policy': CircleX,
  'warranty-policy': BadgeCheck,
  faq: CircleHelp,
  'grievance-redressal': Phone,
}
export const DEFAULT_POLICY_ICON: IconComponent = FileText

export const openPolicyPdf = (slug: string) => {
  const url = absUrl(`/api/legal/${slug}/pdf`)
  if (url) Linking.openURL(url)
}
