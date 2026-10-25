import { useState } from 'react'
import { Keyboard, Pressable, View } from 'react-native'
import { Check, ChevronDown } from 'lucide-react-native'
import { useTokens } from '../theme'
import { Text } from './Text'
import { FieldError, FieldFrame, Label } from './TextField'
import { ModalSheet } from './ModalSheet'
import { cn } from './cn'
import { haptic } from './haptics'

export interface SelectOption {
  value: string
  label: string
  description?: string
}

/** A field that opens a sheet of options. */
export function SelectField({
  label,
  value,
  options,
  onChange,
  placeholder = 'Select',
  sheetTitle,
  error,
  required,
  disabled,
  className,
}: {
  label?: string
  value: string
  options: SelectOption[]
  onChange: (v: string) => void
  placeholder?: string
  sheetTitle?: string
  error?: string | null
  required?: boolean
  disabled?: boolean
  className?: string
}) {
  const t = useTokens()
  const [open, setOpen] = useState(false)
  const selected = options.find(o => o.value === value)
  return (
    <View className={className}>
      {label ? <Label required={required}>{label}</Label> : null}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${label ?? placeholder}: ${selected?.label ?? 'not set'}`}
        disabled={disabled}
        onPress={() => {
          Keyboard.dismiss()
          setOpen(true)
        }}
      >
        <FieldFrame focused={open} invalid={!!error} disabled={disabled}>
          <Text numberOfLines={1} className={cn('flex-1 text-base', selected ? 'text-foreground' : 'text-foreground-muted')}>
            {selected?.label ?? placeholder}
          </Text>
          <ChevronDown size={18} color={open ? t.accent500 : t.foregroundMuted} />
        </FieldFrame>
      </Pressable>
      <FieldError message={error} />
      <ModalSheet open={open} onClose={() => setOpen(false)} title={sheetTitle ?? label ?? placeholder}>
        <View className="-mx-2">
          {options.map(o => {
            const on = o.value === value
            return (
              <Pressable
                key={o.value}
                accessibilityRole="radio"
                accessibilityState={{ checked: on }}
                onPress={() => {
                  haptic.select()
                  onChange(o.value)
                  setOpen(false)
                }}
                className={cn('min-h-[52px] flex-row items-center gap-3 rounded-field px-3 py-3', on ? 'bg-accent-50 dark:bg-accent-900/20' : 'active:bg-surface-secondary')}
              >
                <View className="flex-1">
                  <Text className={cn('text-base', on ? 'font-bold text-accent-700 dark:text-accent-300' : 'text-foreground')}>{o.label}</Text>
                  {o.description ? <Text className="mt-0.5 text-[13px] text-foreground-muted">{o.description}</Text> : null}
                </View>
                {on ? <Check size={18} color={t.accent600} strokeWidth={2.6} /> : null}
              </Pressable>
            )
          })}
        </View>
      </ModalSheet>
    </View>
  )
}
