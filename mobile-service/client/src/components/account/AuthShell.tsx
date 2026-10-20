import type { ReactNode, Ref } from 'react'
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native'
import TopNav from '../layout/TopNav'
import HeroIcon, { GoogleLogo, type HeroIconName } from './HeroIcon'
import { useTokens } from '../../theme'
import type { OtpChannel } from '../../api/auth'

// The storefront's (auth)/login + signup page frame: centred card on bg-surface under the header.

const SHADOW_LG = '0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -4px rgba(0, 0, 0, 0.1)'

export function AuthShell({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  return (
    <View className="flex-1 bg-surface">
      <TopNav />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} className="flex-1">
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', paddingVertical: 48, paddingHorizontal: 16 }}>
          <View className="bg-surface-elevated rounded-lg p-4" style={{ boxShadow: SHADOW_LG }}>
            <View className="items-center mb-8">
              <Text className="text-3xl font-bold text-foreground text-center">{title}</Text>
              <Text className="mt-2 text-sm text-foreground-secondary text-center">{subtitle}</Text>
            </View>
            {children}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  )
}

/** "Continue with Google" + the "or continue with …" divider. */
export function GoogleButton({ label, loadingLabel, loading, onPress, dividerText }: { label: string; loadingLabel: string; loading: boolean; onPress: () => void; dividerText: string }) {
  const t = useTokens()
  return (
    <>
      <Pressable
        onPress={onPress}
        disabled={loading}
        className={`w-full flex-row items-center justify-center gap-3 px-4 py-3 rounded-lg border border-border-secondary bg-surface mb-4 ${loading ? 'opacity-60' : ''}`}
      >
        {loading ? <ActivityIndicator size="small" color={t.foregroundMuted} /> : <GoogleLogo size={20} />}
        <Text className="text-sm font-medium text-foreground">{loading ? loadingLabel : label}</Text>
      </Pressable>
      <View className="mb-6 justify-center">
        <View className="absolute left-0 right-0 border-t border-border-default" />
        <View className="items-center">
          <Text className="px-3 bg-surface-elevated text-xs text-foreground-muted">{dividerText}</Text>
        </View>
      </View>
    </>
  )
}

export const CHANNELS: { id: OtpChannel; label: string; icon: HeroIconName }[] = [
  { id: 'email', label: 'Email', icon: 'mail' },
  { id: 'sms', label: 'SMS', icon: 'phone' },
  { id: 'whatsapp', label: 'WhatsApp', icon: 'chat' },
]

/** The inline "Send OTP via" segmented choice. */
export function ChannelSelector({
  options,
  value,
  onChange,
  isDisabled,
}: {
  options: typeof CHANNELS
  value: OtpChannel
  onChange: (c: OtpChannel) => void
  isDisabled?: (c: OtpChannel) => boolean
}) {
  const t = useTokens()
  return (
    <View className="flex-row gap-2">
      {options.map(opt => {
        const active = value === opt.id
        const disabled = !!isDisabled?.(opt.id)
        return (
          <Pressable
            key={opt.id}
            disabled={disabled}
            onPress={() => onChange(opt.id)}
            className={`flex-1 flex-row items-center justify-center gap-1.5 px-3 py-2.5 rounded-lg border-2 ${
              active ? 'border-accent-500 bg-accent-50 dark:bg-accent-900/20' : 'border-border-secondary bg-surface'
            } ${disabled ? 'opacity-40' : ''}`}
          >
            <HeroIcon name={opt.icon} size={20} color={active ? t.accent600 : disabled ? t.foregroundMuted : t.foregroundSecondary} />
            <Text className={`text-sm font-medium ${active ? 'text-accent-600 dark:text-accent-400' : disabled ? 'text-foreground-muted' : 'text-foreground-secondary'}`}>
              {opt.label}
            </Text>
          </Pressable>
        )
      })}
    </View>
  )
}

/** The blue "We've sent a 6-digit verification code to …" note. */
export function SentNote({ children }: { children: ReactNode }) {
  return (
    <View className="bg-blue-50 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-800 rounded-lg p-4 mb-4">
      <Text className="text-sm text-blue-800 dark:text-blue-300">{children}</Text>
    </View>
  )
}

/** "Verification Code" input: centred, wide tracking, green ring once 6 digits are in. */
export function OtpField({ value, onChange, inputRef }: { value: string; onChange: (v: string) => void; inputRef?: Ref<TextInput> }) {
  const t = useTokens()
  return (
    <TextInput
      ref={inputRef}
      value={value}
      onChangeText={v => onChange(v.replace(/\D/g, '').slice(0, 6))}
      keyboardType="number-pad"
      maxLength={6}
      autoFocus
      textContentType="oneTimeCode"
      autoComplete="sms-otp"
      placeholder="000000"
      placeholderTextColor={t.foregroundMuted}
      className={`w-full px-4 py-3 rounded-lg bg-surface text-foreground text-center text-2xl ${value.length === 6 ? 'border-2 border-green-500' : 'border border-border-secondary'}`}
      style={{ letterSpacing: 2.4 }}
    />
  )
}
