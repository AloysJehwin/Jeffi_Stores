import { useEffect, useRef, useState, type ReactNode } from 'react'
import { ActivityIndicator, Animated, Pressable, Text, TextInput, View, type TextInputProps } from 'react-native'
import { useRouter } from 'expo-router'
import HeroIcon from './HeroIcon'
import { accent, useTokens } from '../../theme'
import { DateField, formatDate } from '../ui/DatePickerSheet'
import type { InfiniteList } from './hooks'

// Shared bits of the storefront's account/auth markup at the mobile breakpoint.

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

/** `<input className="w-full px-4 py-3 border border-border-secondary rounded-lg bg-surface ...">` */
export function Input({
  className = '',
  dense,
  compact,
  muted,
  ...props
}: TextInputProps & { className?: string; dense?: boolean; compact?: boolean; muted?: boolean }) {
  const t = useTokens()
  const pad = dense ? 'px-3 py-2 text-xs' : compact ? 'px-4 py-2' : 'px-4 py-3'
  return (
    <TextInput
      placeholderTextColor={t.foregroundMuted}
      className={`w-full border border-border-secondary rounded-lg ${muted ? 'bg-surface-secondary text-foreground-muted' : 'bg-surface text-foreground'} ${pad} ${className}`}
      {...props}
    />
  )
}

export function Label({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <Text className={`text-sm font-medium text-foreground-secondary mb-2 ${className}`}>{children}</Text>
}

/** The +91 prefix + 10-digit input. */
export function PhoneInput({ value, onChange, dense, autoFocus }: { value: string; onChange: (v: string) => void; dense?: boolean; autoFocus?: boolean }) {
  const t = useTokens()
  return (
    <View className="flex-row">
      <View className={`justify-center border border-r-0 border-border-secondary rounded-l-lg bg-surface-secondary ${dense ? 'px-2.5' : 'px-4'}`}>
        <Text className={`text-foreground-secondary font-medium ${dense ? 'text-xs' : 'text-sm'}`}>+91</Text>
      </View>
      <TextInput
        value={value}
        onChangeText={v => onChange(v.replace(/\D/g, '').slice(0, 10))}
        keyboardType="number-pad"
        maxLength={10}
        autoFocus={autoFocus}
        placeholder="00000 00000"
        placeholderTextColor={t.foregroundMuted}
        className={`flex-1 border border-border-secondary rounded-r-lg bg-surface text-foreground ${dense ? 'px-3 py-2 text-xs' : 'px-4 py-3'}`}
      />
    </View>
  )
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
export function DobInput({ value, onChange, dense }: { value: string; onChange: (v: string) => void; dense?: boolean }) {
  const t = useTokens()
  const { min, max, initial } = dobRange()
  return (
    <DateField value={value} onChange={onChange} title="Date of birth" min={min} max={max} defaultView={initial} startWith="year">
      {open => (
        <View
          className={`w-full flex-row items-center gap-2 border rounded-lg bg-surface ${open ? 'border-accent-500' : 'border-border-secondary'} ${dense ? 'px-3 py-2' : 'px-4 py-3'}`}
        >
          <Text className={`flex-1 ${dense ? 'text-xs' : 'leading-5'} ${value ? 'text-foreground' : 'text-foreground-muted'}`}>
            {value ? formatDate(value) : 'Select date'}
          </Text>
          <HeroIcon name="calendar" size={16} color={open ? accent[500] : t.foregroundMuted} />
        </View>
      )}
    </DateField>
  )
}

export function ErrorBox({ message, className = 'mb-6' }: { message: string; className?: string }) {
  if (!message) return null
  return (
    <View className={`bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 px-4 py-3 rounded-lg ${className}`}>
      <Text className="text-red-700 dark:text-red-300">{message}</Text>
    </View>
  )
}

export function Checkbox({ checked, onChange, children }: { checked: boolean; onChange: (v: boolean) => void; children: ReactNode }) {
  return (
    <Pressable onPress={() => onChange(!checked)} className="flex-row items-start gap-2">
      <View className={`mt-0.5 w-4 h-4 rounded border items-center justify-center ${checked ? 'bg-accent-500 border-accent-500' : 'border-border-secondary bg-surface'}`}>
        {checked && <HeroIcon name="check" size={12} color="white" strokeWidth={3} />}
      </View>
      <View className="flex-1">{children}</View>
    </Pressable>
  )
}

/** "I agree to the Privacy Policy and Terms & Conditions." */
export function PolicyConsent({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  const router = useRouter()
  return (
    <Checkbox checked={checked} onChange={onChange}>
      <Text className="text-sm text-foreground-secondary">
        I agree to the{' '}
        <Text className="text-accent-500 font-medium" onPress={() => router.push('/legal/privacy-policy')}>
          Privacy Policy
        </Text>{' '}
        and{' '}
        <Text className="text-accent-500 font-medium" onPress={() => router.push('/legal/terms-and-conditions')}>
          Terms &amp; Conditions
        </Text>
        .
      </Text>
    </Checkbox>
  )
}

/** `bg-accent-500 text-white rounded-lg font-semibold py-3` with the web's spinner + disabled grey. */
export function PrimaryButton({
  label,
  loadingLabel,
  loading,
  disabled,
  onPress,
  className = '',
}: {
  label: string
  loadingLabel?: string
  loading?: boolean
  disabled?: boolean
  onPress: () => void
  className?: string
}) {
  const off = disabled || loading
  return (
    <Pressable
      onPress={onPress}
      disabled={off}
      className={`w-full px-6 py-3 rounded-lg flex-row items-center justify-center ${off ? 'bg-gray-300 dark:bg-gray-700' : 'bg-accent-500 active:bg-accent-600'} ${className}`}
    >
      {loading && <ActivityIndicator size="small" color="white" style={{ marginRight: 8 }} />}
      <Text className="text-white font-semibold">{loading && loadingLabel ? loadingLabel : label}</Text>
    </Pressable>
  )
}

/** animate-pulse block. */
export function Pulse({ className = '', style }: { className?: string; style?: object }) {
  const v = useRef(new Animated.Value(1)).current
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(v, { toValue: 0.5, duration: 1000, useNativeDriver: true }),
        Animated.timing(v, { toValue: 1, duration: 1000, useNativeDriver: true }),
      ])
    )
    loop.start()
    return () => loop.stop()
  }, [v])
  return <Animated.View className={className} style={[{ opacity: v }, style]} />
}

/** The admin kit's InfiniteFooter: load-more state + "Showing N of M noun". */
export function InfiniteFooter({ shown, list, noun }: { shown: number; list: InfiniteList<any>; noun: string }) {
  const t = useTokens()
  if (!shown && !list.hasMore && !list.error) return null
  const of = list.total != null && list.total >= shown ? list.total : null
  return (
    <View className="px-1 pt-3">
      {list.error ? (
        <View className="flex-row items-center justify-center gap-2 rounded-lg border border-red-500/30 bg-red-500/5 px-3 py-2">
          <Text className="text-xs text-red-600 dark:text-red-400">{list.error}</Text>
          <Pressable onPress={list.loadMore} className="rounded border border-red-500/40 px-2 py-1">
            <Text className="text-xs text-red-600 dark:text-red-400">Retry</Text>
          </Pressable>
        </View>
      ) : list.loadingMore ? (
        <View className="flex-row items-center justify-center gap-2 py-2">
          <ActivityIndicator size="small" color={t.foregroundMuted} />
          <Text className="text-xs text-foreground-muted">Loading more...</Text>
        </View>
      ) : list.hasMore ? (
        <View className="items-center py-1">
          <Pressable onPress={list.loadMore} className="rounded-md border border-border-default px-3 py-1.5">
            <Text className="text-xs text-foreground-secondary">Load more</Text>
          </Pressable>
        </View>
      ) : null}
      {shown > 0 && (
        <Text className="pt-1 text-center text-xs text-foreground-muted">
          Showing <Text className="font-medium text-foreground">{shown}</Text>
          {of != null && (
            <>
              {' '}of <Text className="font-medium text-foreground">{of}</Text>
            </>
          )}{' '}
          {noun}
        </Text>
      )}
    </View>
  )
}

/** Pill-style filter chip: `px-3 py-1 rounded-full text-xs font-medium`. */
export function FilterChip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      className={`px-3 py-1 rounded-full ${active ? 'bg-accent-500' : 'bg-surface-elevated border border-border-default'}`}
    >
      <Text className={`text-xs font-medium capitalize ${active ? 'text-white' : 'text-foreground-secondary'}`}>{label}</Text>
    </Pressable>
  )
}

/** The status-badge lookups the order pages share (bg + text kept apart for RN). */
export const ORDER_STATUS_TONE: Record<string, { bg: string; text: string }> = {
  pending: { bg: 'bg-yellow-100 dark:bg-yellow-900/30', text: 'text-yellow-800 dark:text-yellow-300' },
  unpaid: { bg: 'bg-yellow-100 dark:bg-yellow-900/30', text: 'text-yellow-800 dark:text-yellow-300' },
  confirmed: { bg: 'bg-blue-100 dark:bg-blue-900/30', text: 'text-blue-800 dark:text-blue-300' },
  processing: { bg: 'bg-blue-100 dark:bg-blue-900/30', text: 'text-blue-800 dark:text-blue-300' },
  shipped: { bg: 'bg-purple-100 dark:bg-purple-900/30', text: 'text-purple-800 dark:text-purple-300' },
  out_for_delivery: { bg: 'bg-indigo-100 dark:bg-indigo-900/30', text: 'text-indigo-800 dark:text-indigo-300' },
  delivered: { bg: 'bg-green-100 dark:bg-green-900/30', text: 'text-green-800 dark:text-green-300' },
  granted: { bg: 'bg-green-100 dark:bg-green-900/30', text: 'text-green-800 dark:text-green-300' },
  paid: { bg: 'bg-green-100 dark:bg-green-900/30', text: 'text-green-800 dark:text-green-300' },
  completed: { bg: 'bg-green-100 dark:bg-green-900/30', text: 'text-green-800 dark:text-green-300' },
  cancel_requested: { bg: 'bg-orange-100 dark:bg-orange-900/30', text: 'text-orange-800 dark:text-orange-300' },
  cancelled: { bg: 'bg-red-100 dark:bg-red-900/30', text: 'text-red-800 dark:text-red-300' },
  failed: { bg: 'bg-red-100 dark:bg-red-900/30', text: 'text-red-800 dark:text-red-300' },
  return_requested: { bg: 'bg-orange-100 dark:bg-orange-900/30', text: 'text-orange-800 dark:text-orange-300' },
  return_approved: { bg: 'bg-blue-100 dark:bg-blue-900/30', text: 'text-blue-800 dark:text-blue-300' },
  return_received: { bg: 'bg-blue-100 dark:bg-blue-900/30', text: 'text-blue-800 dark:text-blue-300' },
  return_rejected: { bg: 'bg-red-100 dark:bg-red-900/30', text: 'text-red-800 dark:text-red-300' },
  returned: { bg: 'bg-purple-100 dark:bg-purple-900/30', text: 'text-purple-800 dark:text-purple-300' },
  refunded: { bg: 'bg-purple-100 dark:bg-purple-900/30', text: 'text-purple-800 dark:text-purple-300' },
}
export const NEUTRAL_TONE = { bg: 'bg-surface-secondary', text: 'text-foreground' }

export function StatusPill({ tone, label, className = 'px-2.5 py-0.5', textClass = 'text-xs font-medium' }: { tone: { bg: string; text: string }; label: string; className?: string; textClass?: string }) {
  return (
    <View className={`rounded-full ${tone.bg} ${className}`}>
      <Text className={`${tone.text} ${textClass}`}>{label}</Text>
    </View>
  )
}

/** The order status labels the orders list uses. */
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

/** CustomSelect: the bordered button + its option list (drops open inline). */
export function Select({
  label,
  value,
  options,
  onChange,
  placeholder = 'Select...',
}: {
  label?: string
  value: string
  options: { value: string; label: string }[]
  onChange: (v: string) => void
  placeholder?: string
}) {
  const t = useTokens()
  const [open, setOpen] = useState(false)
  const selected = options.find(o => o.value === value)
  return (
    <View>
      {!!label && <Label>{label}</Label>}
      <Pressable
        onPress={() => setOpen(o => !o)}
        className={`w-full px-4 py-2.5 bg-surface-elevated border rounded-lg flex-row items-center justify-between gap-2 ${open ? 'border-accent-500' : 'border-border-secondary'}`}
      >
        <Text className={`text-sm ${selected ? 'text-foreground' : 'text-foreground-muted'}`}>{selected?.label ?? placeholder}</Text>
        <View style={{ transform: [{ rotate: open ? '180deg' : '0deg' }] }}>
          <HeroIcon name="chevronDown" size={16} color={t.foregroundMuted} />
        </View>
      </Pressable>
      {open && (
        <View className="mt-1 bg-surface-elevated border border-border-default rounded-lg overflow-hidden py-1" style={{ boxShadow: '0 10px 15px -3px rgba(0,0,0,0.1), 0 4px 6px -4px rgba(0,0,0,0.1)' }}>
          {options.map(o => {
            const on = o.value === value
            return (
              <Pressable
                key={o.value}
                onPress={() => {
                  onChange(o.value)
                  setOpen(false)
                }}
                className="px-4 py-2.5 flex-row items-center justify-between active:bg-accent-50"
              >
                <Text className={`text-sm ${on ? 'font-medium text-accent-600 dark:text-accent-400' : 'text-foreground-secondary'}`}>{o.label}</Text>
                {on && <HeroIcon name="check" size={16} color={accent[500]} strokeWidth={2.5} />}
              </Pressable>
            )
          })}
        </View>
      )}
    </View>
  )
}
