import { forwardRef, useState, type ReactNode } from 'react'
import { Pressable, TextInput, View, type TextInputProps } from 'react-native'
import { X } from 'lucide-react-native'
import { useTokens } from '../theme'
import { Text } from './Text'
import { cn } from './cn'
import type { IconComponent } from './Button'

export function Label({ children, required, className }: { children: ReactNode; required?: boolean; className?: string }) {
  return (
    <Text className={cn('mb-1.5 text-[13px] font-semibold text-foreground-secondary', className)}>
      {children}
      {required ? <Text className="text-red-600 dark:text-red-400"> *</Text> : null}
    </Text>
  )
}

export function HelperText({ children }: { children: ReactNode }) {
  return <Text className="mt-1.5 text-xs leading-4 text-foreground-muted">{children}</Text>
}

export function FieldError({ message, className }: { message?: string | null; className?: string }) {
  if (!message) return null
  return (
    <Text accessibilityLiveRegion="polite" className={cn('mt-1.5 text-[13px] font-medium text-red-600 dark:text-red-400', className)}>
      {message}
    </Text>
  )
}

/** The input frame: tall, rounded, accent ring while focused, red when invalid. */
export function FieldFrame({
  focused,
  invalid,
  disabled,
  multiline,
  children,
  className,
}: {
  focused?: boolean
  invalid?: boolean
  disabled?: boolean
  multiline?: boolean
  children: ReactNode
  className?: string
}) {
  const ring = invalid
    ? 'border-red-500 bg-red-50/40 dark:bg-red-900/10'
    : focused
      ? 'border-accent-500 bg-accent-50 dark:bg-accent-900/20'
      : 'border-border-secondary bg-surface'
  return (
    <View
      className={cn(
        'flex-row rounded-field border-2 px-4',
        multiline ? 'min-h-[112px] items-start py-3' : 'h-14 items-center',
        ring,
        disabled && 'opacity-60',
        className,
      )}
    >
      {children}
    </View>
  )
}

export interface TextFieldProps extends Omit<TextInputProps, 'style'> {
  label?: string
  required?: boolean
  helper?: string
  error?: string | null
  prefix?: ReactNode
  suffix?: ReactNode
  icon?: IconComponent
  /** Tapping it clears the field. */
  clearable?: boolean
  containerClassName?: string
  className?: string
}

export const TextField = forwardRef<TextInput, TextFieldProps>(function TextField(
  { label, required, helper, error, prefix, suffix, icon: Icon, clearable, containerClassName, className, onFocus, onBlur, editable = true, multiline, ...props },
  ref,
) {
  const t = useTokens()
  const [focused, setFocused] = useState(false)
  return (
    <View className={containerClassName}>
      {label ? <Label required={required}>{label}</Label> : null}
      <FieldFrame focused={focused} invalid={!!error} disabled={!editable} multiline={multiline}>
        {Icon ? (
          <View className="mr-2.5">
            <Icon size={18} color={focused ? t.accent500 : t.foregroundMuted} />
          </View>
        ) : null}
        {typeof prefix === 'string' ? <Text className="mr-2 text-base font-semibold text-foreground-secondary">{prefix}</Text> : prefix}
        <TextInput
          ref={ref}
          accessibilityLabel={label}
          placeholderTextColor={t.foregroundMuted}
          editable={editable}
          multiline={multiline}
          textAlignVertical={multiline ? 'top' : 'center'}
          onFocus={e => {
            setFocused(true)
            onFocus?.(e)
          }}
          onBlur={e => {
            setFocused(false)
            onBlur?.(e)
          }}
          className={cn('flex-1 font-inter text-base text-foreground', multiline ? 'min-h-[84px]' : 'h-full', className)}
          {...props}
        />
        {clearable && props.value ? (
          <Pressable accessibilityLabel="Clear" hitSlop={10} onPress={() => props.onChangeText?.('')} className="ml-2 h-6 w-6 items-center justify-center rounded-full bg-border-default">
            <X size={14} color={t.foregroundSecondary} strokeWidth={2.5} />
          </Pressable>
        ) : null}
        {typeof suffix === 'string' ? <Text className="ml-2 text-sm font-medium text-foreground-muted">{suffix}</Text> : suffix}
      </FieldFrame>
      <FieldError message={error} />
      {!error && helper ? <HelperText>{helper}</HelperText> : null}
    </View>
  )
})

/** +91 and a 10-digit number. */
export const PhoneField = forwardRef<TextInput, Omit<TextFieldProps, 'onChangeText' | 'onChange' | 'value'> & { value: string; onChange: (v: string) => void }>(
  function PhoneField({ value, onChange, ...props }, ref) {
    return (
      <TextField
        ref={ref}
        value={value}
        onChangeText={v => onChange(v.replace(/\D/g, '').slice(0, 10))}
        keyboardType="phone-pad"
        textContentType="telephoneNumber"
        autoComplete="tel"
        maxLength={10}
        placeholder="10-digit mobile number"
        prefix={
          <View className="mr-3 flex-row items-center border-r border-border-default pr-3">
            <Text className="text-base font-semibold text-foreground-secondary">+91</Text>
          </View>
        }
        {...props}
      />
    )
  },
)
