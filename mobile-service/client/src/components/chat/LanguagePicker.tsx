import { useState } from 'react'
import { Pressable, View } from 'react-native'
import { Languages } from 'lucide-react-native'
import { ModalSheet, Radio, Text } from '../../ui'
import { useTokens } from '../../theme'
import { SUPPORT_LANGUAGES } from '../../types/support'

/** The chat language: a compact header button opening a sheet of languages in their own script. */
export default function LanguagePicker({ value, onChange }: { value: string | null; onChange: (lang: string) => void }) {
  const t = useTokens()
  const [open, setOpen] = useState(false)
  const current = SUPPORT_LANGUAGES.find(l => l.code === (value ?? 'en')) ?? SUPPORT_LANGUAGES[0]
  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Chat language, ${current.label}`}
        hitSlop={6}
        onPress={() => setOpen(true)}
        className="h-9 max-w-[112px] flex-row items-center gap-1.5 rounded-full border border-border-default px-2.5 active:bg-surface-secondary"
      >
        <Languages size={15} color={t.foregroundSecondary} />
        <Text numberOfLines={1} className="shrink text-xs font-semibold text-foreground-secondary">
          {current.native}
        </Text>
      </Pressable>
      <ModalSheet open={open} onClose={() => setOpen(false)} title="Chat language" subtitle="Messages are translated both ways.">
        <View className="pb-2">
          {SUPPORT_LANGUAGES.map(l => (
            <Radio
              key={l.code}
              selected={l.code === current.code}
              label={l.native}
              description={l.native === l.label ? undefined : l.label}
              onSelect={() => {
                setOpen(false)
                if (l.code !== current.code) onChange(l.code)
              }}
            />
          ))}
        </View>
      </ModalSheet>
    </>
  )
}
