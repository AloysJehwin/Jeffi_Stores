import { TouchableOpacity, Text, ActivityIndicator, ViewStyle, TextStyle } from 'react-native'

interface ButtonProps {
  label: string
  onPress: () => void
  variant?: 'primary' | 'secondary' | 'outline' | 'danger'
  loading?: boolean
  disabled?: boolean
  fullWidth?: boolean
  size?: 'sm' | 'md' | 'lg'
}

const variantClasses: Record<string, string> = {
  primary: 'bg-accent-500 active:bg-accent-600',
  secondary: 'bg-gray-200 dark:bg-[#2e303b] active:bg-gray-300',
  outline: 'border border-accent-500 bg-transparent',
  danger: 'bg-red-500 active:bg-red-600',
}

const textClasses: Record<string, string> = {
  primary: 'text-white',
  secondary: 'text-gray-800 dark:text-gray-200',
  outline: 'text-accent-500',
  danger: 'text-white',
}

const sizeClasses: Record<string, string> = {
  sm: 'px-4 py-2',
  md: 'px-6 py-3',
  lg: 'px-8 py-4',
}

const textSizeClasses: Record<string, string> = {
  sm: 'text-sm',
  md: 'text-base',
  lg: 'text-lg',
}

export default function Button({
  label,
  onPress,
  variant = 'primary',
  loading = false,
  disabled = false,
  fullWidth = false,
  size = 'md',
}: ButtonProps) {
  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled || loading}
      className={`rounded-xl items-center justify-center flex-row gap-2 ${variantClasses[variant]} ${sizeClasses[size]} ${fullWidth ? 'w-full' : ''} ${disabled || loading ? 'opacity-50' : ''}`}
    >
      {loading && <ActivityIndicator size="small" color={variant === 'secondary' || variant === 'outline' ? '#7cb900' : '#fff'} />}
      <Text className={`font-semibold ${textClasses[variant]} ${textSizeClasses[size]}`}>{label}</Text>
    </TouchableOpacity>
  )
}
