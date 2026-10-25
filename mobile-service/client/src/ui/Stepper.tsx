import { useState } from 'react'
import { TextInput, View, type NativeSyntheticEvent, type TextInputEndEditingEventData } from 'react-native'
import { Minus, Plus } from 'lucide-react-native'
import { useTokens } from '../theme'
import { IconButton } from './Button'
import Spinner from './Spinner'
import { cn } from './cn'

/** − qty + for quantity pickers; the value can be typed in place. Without the step handlers it's a compact number field. */
export function Stepper({
  value,
  defaultValue,
  onChangeText,
  onEndEditing,
  onDecrement,
  onIncrement,
  canDecrement = true,
  canIncrement = true,
  decimal,
  busy,
  disabled,
  itemName,
  inputKey,
  width = 48,
  className,
}: {
  value?: string
  /** Uncontrolled; pair with `inputKey` to reset it when the committed value changes. */
  defaultValue?: string
  onChangeText?: (raw: string) => void
  onEndEditing?: (e: NativeSyntheticEvent<TextInputEndEditingEventData>) => void
  onDecrement?: () => void
  onIncrement?: () => void
  canDecrement?: boolean
  canIncrement?: boolean
  decimal?: boolean
  /** A save in flight: the value is swapped for a spinner. */
  busy?: boolean
  disabled?: boolean
  /** Added to the buttons' labels ("Decrease quantity for …"). */
  itemName?: string
  inputKey?: string
  /** Width of the value. */
  width?: number
  className?: string
}) {
  const t = useTokens()
  const [focused, setFocused] = useState(false)
  const suffix = itemName ? ` for ${itemName}` : ''
  const steps = !!(onDecrement || onIncrement)
  return (
    <View
      className={cn(
        'h-11 flex-row items-center self-start rounded-full border-2',
        steps ? 'px-0.5' : 'px-3',
        focused ? 'border-accent-500 bg-accent-50 dark:bg-accent-900/20' : 'border-border-secondary bg-surface',
        disabled && 'opacity-50',
        className,
      )}
    >
      {steps ? (
        <IconButton icon={Minus} label={`Decrease quantity${suffix}`} size="sm" onPress={onDecrement} disabled={disabled || busy || !canDecrement} />
      ) : null}
      {busy ? (
        <View style={{ width }} className="items-center">
          <Spinner size="small" fill={false} />
        </View>
      ) : (
        <TextInput
          key={inputKey}
          value={value}
          defaultValue={defaultValue}
          onChangeText={onChangeText}
          onEndEditing={onEndEditing}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          editable={!disabled}
          keyboardType={decimal ? 'decimal-pad' : 'number-pad'}
          selectTextOnFocus
          accessibilityLabel={`Quantity${suffix}`}
          placeholderTextColor={t.foregroundMuted}
          style={{ width, fontVariant: ['tabular-nums'] }}
          className="h-full text-center font-inter text-base font-semibold text-foreground"
        />
      )}
      {steps ? (
        <IconButton icon={Plus} label={`Increase quantity${suffix}`} size="sm" onPress={onIncrement} disabled={disabled || busy || !canIncrement} />
      ) : null}
    </View>
  )
}
