import { View } from 'react-native'
import { useRouter } from 'expo-router'
import { Calendar } from 'lucide-react-native'
import { Button, Caption, Checkbox, cn, DateField, FieldError, FieldFrame, formatDate, Label, Spinner, Text, TextButton } from '../../ui'
import { useTokens } from '../../theme'
import type { InfiniteList } from './hooks'

// Shared bits of the account and auth screens.

export const MIN_AGE_YEARS = 3
export const MAX_AGE_YEARS = 120

/** lib/shared/format normalizeDob: YYYY-MM-DD, a real past date, age 3–120. */
export function isValidDob(value: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec((value || '').trim())
  if (!m) return false
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])]
  const dob = new Date(Date.UTC(y, mo - 1, d))
  if (dob.getUTCFullYear() !== y || dob.getUTCMonth() !== mo - 1 || dob.getUTCDate() !== d) return false
  const now = new Date()
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
  if (dob.getTime() > today.getTime()) return false
  let age = today.getUTCFullYear() - y
  if (today.getUTCMonth() < mo - 1 || (today.getUTCMonth() === mo - 1 && today.getUTCDate() < d)) age--
  return age >= MIN_AGE_YEARS && age <= MAX_AGE_YEARS
}

export function errMsg(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback
}

/** isValidDob's first and last allowed dates, and where the picker opens (about 25 years back). */
export function dobRange(): { min: string; max: string; initial: string } {
  const now = new Date()
  const [y, m, d] = [now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()]
  const at = (years: number, days: number) => new Date(Date.UTC(y - years, m, d + days)).toISOString().slice(0, 10)
  // Step a day at a time so Feb 29 and the birthday itself land exactly where isValidDob draws the line.
  let max = at(MIN_AGE_YEARS, 0)
  for (let i = 1; !isValidDob(max) && i < 4; i++) max = at(MIN_AGE_YEARS, -i)
  let min = at(MAX_AGE_YEARS + 1, 0)
  for (let i = 1; !isValidDob(min) && i < 4; i++) min = at(MAX_AGE_YEARS + 1, i)
  return { min, max, initial: at(25, 0) }
}

/** A date-of-birth field that opens the app's date picker. */
export function DobInput({ value, onChange, label, required, error }: { value: string; onChange: (v: string) => void; label?: string; required?: boolean; error?: string | null }) {
  const t = useTokens()
  const { min, max, initial } = dobRange()
  return (
    <View>
      {label ? <Label required={required}>{label}</Label> : null}
      <DateField value={value} onChange={onChange} title="Date of birth" min={min} max={max} defaultView={initial} startWith="year">
        {open => (
          <FieldFrame focused={open} invalid={!!error}>
            <Text className={cn('flex-1 text-base', value ? 'text-foreground' : 'text-foreground-muted')}>{value ? formatDate(value) : 'Select date'}</Text>
            <Calendar size={18} color={open ? t.accent500 : t.foregroundMuted} />
          </FieldFrame>
        )}
      </DateField>
      <FieldError message={error} />
    </View>
  )
}

/** "I agree to the Privacy Policy and Terms & Conditions." */
export function PolicyConsent({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  const router = useRouter()
  return (
    <Checkbox checked={checked} onChange={onChange}>
      <Text className="text-sm leading-[22px] text-foreground-secondary">
        I agree to the{' '}
        <Text className="font-semibold text-accent-600 dark:text-accent-400" onPress={() => router.push('/legal/privacy-policy')}>
          Privacy Policy
        </Text>{' '}
        and{' '}
        <Text className="font-semibold text-accent-600 dark:text-accent-400" onPress={() => router.push('/legal/terms-and-conditions')}>
          Terms &amp; Conditions
        </Text>
        .
      </Text>
    </Checkbox>
  )
}

/** Load-more state under a paged list, and "Showing N of M noun". */
export function InfiniteFooter({ shown, list, noun }: { shown: number; list: InfiniteList<any>; noun: string }) {
  if (!shown && !list.hasMore && !list.error) return null
  const of = list.total != null && list.total >= shown ? list.total : null
  return (
    <View className="gap-2 pt-3">
      {list.error ? (
        <View className="flex-row items-center gap-3 rounded-field bg-red-50 px-4 py-2 dark:bg-red-900/20">
          <Text className="flex-1 text-[13px] text-red-700 dark:text-red-300">{list.error}</Text>
          <TextButton label="Retry" tone="danger" onPress={list.loadMore} />
        </View>
      ) : list.loadingMore ? (
        <Spinner size="small" fill={false} label="Loading more…" className="py-1" />
      ) : list.hasMore ? (
        <View className="flex-row justify-center">
          <Button label="Load more" variant="secondary" size="sm" block={false} onPress={list.loadMore} />
        </View>
      ) : null}
      {shown > 0 && (
        <Caption className="text-center">
          Showing <Text className="font-semibold text-foreground">{shown}</Text>
          {of != null && (
            <>
              {' '}of <Text className="font-semibold text-foreground">{of}</Text>
            </>
          )}{' '}
          {noun}
        </Caption>
      )}
    </View>
  )
}

/** The order status labels the order pages use. */
export function orderStatusLabel(status: string): string {
  const map: Record<string, string> = {
    cancel_requested: 'Cancellation Requested',
    cancel_rejected: 'Cancellation Rejected',
    out_for_delivery: 'Out for Delivery',
    granted: 'Access granted',
    return_requested: 'Return Requested',
    return_approved: 'Return Approved',
    return_received: 'Return Received',
    return_rejected: 'Return Rejected',
  }
  return map[status] ?? status.charAt(0).toUpperCase() + status.slice(1)
}
