import { View } from 'react-native'

/** A native radio dot (the web's `<input type="radio">` with text-accent-600). */
export default function Radio({ checked, className = '' }: { checked: boolean; className?: string }) {
  return (
    <View
      className={`h-4 w-4 items-center justify-center rounded-full border ${checked ? 'border-accent-600' : 'border-border-secondary bg-surface'} ${className}`}
    >
      {checked ? <View className="h-2 w-2 rounded-full bg-accent-600" /> : null}
    </View>
  )
}
