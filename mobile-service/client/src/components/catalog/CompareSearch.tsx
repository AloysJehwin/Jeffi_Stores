import { useEffect, useRef, useState } from 'react'
import { Pressable, View } from 'react-native'
import { Image } from 'expo-image'
import { ImageIcon, Plus, Search } from 'lucide-react-native'
import { searchProducts, type ProductSearchResult } from '../../api/products'
import { absUrl } from '../../lib/links'
import { inr } from '../../lib/format'
import { useTokens } from '../../theme'
import { Badge, Button, ModalSheet, Skeleton, Spinner, Text, TextButton, TextField } from '../../ui'

// The compare page's product pickers: CompareAddButton ("Add product") and CompareChangeButton ("Change").
// The web opens them as a dropdown under the button; here the same panel opens as a sheet.

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
    <ModalSheet open={visible} onClose={onClose} title="Find a product">
      <TextField
        autoFocus
        value={query}
        onChangeText={onChange}
        placeholder={placeholder}
        accessibilityLabel={placeholder}
        icon={Search}
        clearable
        returnKeyType="search"
        suffix={loading && results.length > 0 ? <Spinner size="small" fill={false} className="ml-2" /> : undefined}
      />
      <View className="mt-3">
        {results.length > 0 ? (
          results.map(r => {
            const img = absUrl(r.thumbnail_url || r.image_url)
            return (
              <Pressable
                key={r.id}
                onPress={() => onSelect(r)}
                accessibilityRole="button"
                accessibilityLabel={r.name}
                className="-mx-2 flex-row items-center gap-3 rounded-field px-2 py-2.5 active:bg-surface-secondary"
              >
                <View className="h-11 w-11 shrink-0 overflow-hidden rounded-xl border border-border-default bg-surface-secondary">
                  {img ? (
                    <Image recyclingKey={img} source={{ uri: img }} contentFit="contain" style={{ flex: 1, margin: 2 }} />
                  ) : (
                    <View className="flex-1 items-center justify-center">
                      <ImageIcon size={16} strokeWidth={1.5} color={t.foregroundMuted} />
                    </View>
                  )}
                </View>
                <View className="min-w-0 flex-1">
                  <Text numberOfLines={1} className="text-[15px] font-semibold text-foreground">
                    {r.name}
                  </Text>
                  <Text className="text-[13px] text-foreground-muted">
                    {r.brand_name ? `${r.brand_name} · ` : ''}₹{inr(r.price)}
                  </Text>
                </View>
                {categoryId && r.category_id === categoryId ? <Badge label="Same cat" tone="accent" size="sm" /> : null}
              </Pressable>
            )
          })
        ) : query.length >= 2 && loading ? (
          <View accessible accessibilityLabel="Searching">
            {(['70%', '55%', '80%'] as const).map((w, i) => (
              <View key={i} className="flex-row items-center gap-3 py-2.5">
                <Skeleton width={44} height={44} rounded="rounded-xl" />
                <View className="flex-1 gap-1.5">
                  <Skeleton height={13} width={w} />
                  <Skeleton height={10} width="45%" rounded="rounded" />
                </View>
              </View>
            ))}
          </View>
        ) : query.length >= 2 ? (
          <Text className="py-3 text-sm text-foreground-muted">No products found.</Text>
        ) : (
          <Text className="py-3 text-[13px] text-foreground-muted">Type at least 2 characters to search.</Text>
        )}
      </View>
    </ModalSheet>
  )
}

/** "Add product": appends the pick to the comparison. */
export function CompareAddButton({ currentIds, categoryId, onAdd }: { currentIds: string[]; categoryId: string | null; onAdd: (r: ProductSearchResult) => void }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button label="Add product" icon={Plus} variant="outline" size="sm" block={false} onPress={() => setOpen(v => !v)} />
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
      <TextButton label="Change" onPress={() => setOpen(v => !v)} />
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
