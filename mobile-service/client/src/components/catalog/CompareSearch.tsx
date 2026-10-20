import { useEffect, useRef, useState } from 'react'
import { ActivityIndicator, Modal, Pressable, ScrollView, Text, TextInput, View } from 'react-native'
import { Image } from 'expo-image'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { PhotoIcon, PlusIcon, SearchIcon } from './icons'
import { searchProducts, type ProductSearchResult } from '../../api/products'
import { absUrl } from '../../lib/links'
import { inr } from '../../lib/format'
import { accent, useTokens } from '../../theme'

// The compare page's product pickers: CompareAddButton ("Add product") and CompareChangeButton ("Change").
// The web opens them as a dropdown under the button; here the same panel opens as a modal card.

function SearchPanel({
  visible,
  onClose,
  onSelect,
  categoryId,
  excludeIds,
  placeholder,
}: {
  visible: boolean
  onClose: () => void
  onSelect: (r: ProductSearchResult) => void
  categoryId: string | null
  excludeIds: string[]
  placeholder: string
}) {
  const t = useTokens()
  const insets = useSafeAreaInsets()
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<ProductSearchResult[]>([])
  const [loading, setLoading] = useState(false)
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null)
  const seq = useRef(0)

  useEffect(() => {
    if (!visible) {
      setQuery('')
      setResults([])
    }
  }, [visible])

  const run = async (q: string) => {
    if (q.length < 2) {
      setResults([])
      return
    }
    const n = ++seq.current
    setLoading(true)
    try {
      const rows = await searchProducts(q, { categoryId, excludeIds, limit: 8 })
      if (n === seq.current) setResults(rows)
    } catch {
      if (n === seq.current) setResults([])
    } finally {
      if (n === seq.current) setLoading(false)
    }
  }

  const onChange = (v: string) => {
    setQuery(v)
    if (debounce.current) clearTimeout(debounce.current)
    debounce.current = setTimeout(() => run(v), 280)
  }

  return (
    <Modal visible={visible} transparent animationType="fade" statusBarTranslucent onRequestClose={onClose}>
      <View className="flex-1 items-center" style={{ paddingTop: insets.top + 96 }}>
        <Pressable className="absolute inset-0 bg-black/30" onPress={onClose} accessibilityLabel="Close" />
        <View className="w-72 overflow-hidden rounded-xl border border-border-default bg-surface-elevated shadow-2xl">
          <View className="flex-row items-center gap-2 border-b border-border-default px-3 py-2.5">
            <SearchIcon size={14} color={t.foregroundMuted} />
            <TextInput
              autoFocus
              value={query}
              onChangeText={onChange}
              placeholder={placeholder}
              placeholderTextColor={t.foregroundMuted}
              className="flex-1 p-0 text-sm text-foreground"
              returnKeyType="search"
            />
            {loading ? <ActivityIndicator size="small" color={accent[500]} /> : null}
          </View>
          {results.length > 0 ? (
            <ScrollView style={{ maxHeight: 256 }} keyboardShouldPersistTaps="handled">
              {results.map(r => {
                const img = absUrl(r.thumbnail_url || r.image_url)
                return (
                  <Pressable key={r.id} onPress={() => onSelect(r)} className="flex-row items-center gap-3 px-3 py-2.5 active:bg-surface-secondary">
                    <View className="h-9 w-9 shrink-0 overflow-hidden rounded border border-border-default bg-surface-secondary">
                      {img ? (
                        <Image source={{ uri: img }} contentFit="contain" style={{ flex: 1, margin: 2 }} />
                      ) : (
                        <View className="flex-1 items-center justify-center">
                          <PhotoIcon strokeWidth={1} color={t.foregroundMuted} />
                        </View>
                      )}
                    </View>
                    <View className="min-w-0 flex-1">
                      <Text numberOfLines={1} className="text-sm font-medium text-foreground">
                        {r.name}
                      </Text>
                      <Text className="text-xs text-foreground-muted">
                        {r.brand_name ? `${r.brand_name} · ` : ''}₹{inr(r.price)}
                      </Text>
                    </View>
                    {categoryId && r.category_id === categoryId ? (
                      <View className="shrink-0 rounded bg-accent-50 px-1.5 py-0.5 dark:bg-accent-900/20">
                        <Text className="text-[10px] font-medium text-accent-600">Same cat</Text>
                      </View>
                    ) : null}
                  </Pressable>
                )
              })}
            </ScrollView>
          ) : query.length >= 2 && !loading ? (
            <Text className="px-4 py-3 text-sm text-foreground-muted">No products found.</Text>
          ) : query.length < 2 ? (
            <Text className="px-4 py-3 text-xs text-foreground-muted">Type at least 2 characters to search.</Text>
          ) : null}
        </View>
      </View>
    </Modal>
  )
}

/** "Add product": appends the pick to the comparison. */
export function CompareAddButton({ currentIds, categoryId, onAdd }: { currentIds: string[]; categoryId: string | null; onAdd: (r: ProductSearchResult) => void }) {
  const t = useTokens()
  const [open, setOpen] = useState(false)
  return (
    <>
      <Pressable onPress={() => setOpen(v => !v)} className="flex-row items-center gap-1.5 rounded-lg border border-border-default bg-surface px-3 py-1.5">
        <PlusIcon color={t.foregroundMuted} />
        <Text className="text-sm font-medium text-foreground-muted">Add product</Text>
      </Pressable>
      <SearchPanel
        visible={open}
        onClose={() => setOpen(false)}
        onSelect={r => {
          setOpen(false)
          onAdd(r)
        }}
        categoryId={categoryId}
        excludeIds={currentIds}
        placeholder="Search product to add…"
      />
    </>
  )
}

/** "Change": swaps one compared product for the pick. */
export function CompareChangeButton({
  productId,
  currentIds,
  categoryId,
  onChange,
}: {
  productId: string
  currentIds: string[]
  categoryId: string | null
  onChange: (r: ProductSearchResult) => void
}) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Pressable onPress={() => setOpen(v => !v)} className="self-start">
        <Text className="text-xs font-medium text-accent-500">Change</Text>
      </Pressable>
      <SearchPanel
        visible={open}
        onClose={() => setOpen(false)}
        onSelect={r => {
          setOpen(false)
          onChange(r)
        }}
        categoryId={categoryId}
        excludeIds={currentIds.filter(id => id !== productId)}
        placeholder="Search product…"
      />
    </>
  )
}
