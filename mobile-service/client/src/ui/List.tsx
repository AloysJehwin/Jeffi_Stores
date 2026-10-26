import { useMemo } from 'react'
import { RefreshControl, FlatList, SectionList, View, type FlatListProps, type ScrollViewProps, type SectionListProps } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useTokens } from '../theme'
import { KeyboardScroll } from './KeyboardScroll'

// Long lists render through FlatList so only the rows on screen are mounted. These carry Screen's
// gutter, bottom inset and pull to refresh; put them in a <Screen mode="none">.

interface ListExtras {
  refreshing?: boolean
  onRefresh?: () => void
  /** Horizontal gutter (default 16). */
  padded?: boolean
  /** Keep a focused field (in a row, the header or the footer) above the keyboard. */
  keyboard?: boolean
  /** Space between rows. */
  gap?: number
  /** The screen has a pinned ScreenFooter, which clears the navigation bar itself. */
  footerBar?: boolean
}

function useListProps({ refreshing = false, onRefresh, padded = true, keyboard, gap, footerBar }: ListExtras) {
  const t = useTokens()
  const insets = useSafeAreaInsets()
  // Stable identities, so FlatList doesn't remount separators or the scroller on every render.
  const separator = useMemo(() => (gap ? () => <View style={{ height: gap }} /> : undefined), [gap])
  const scroller = useMemo(() => (keyboard ? (props: ScrollViewProps) => <KeyboardScroll {...props} /> : undefined), [keyboard])
  const bottom = (footerBar ? 16 : insets.bottom) + 24
  const refreshControl = useMemo(
    () =>
      onRefresh ? (
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={t.accent500} colors={[t.accent500]} progressBackgroundColor={t.surfaceElevated} />
      ) : undefined,
    [onRefresh, refreshing, t]
  )
  const contentContainerStyle = useMemo(() => ({ paddingTop: 16, paddingHorizontal: padded ? 16 : 0, paddingBottom: bottom }), [padded, bottom])
  return {
    refreshControl,
    renderScrollComponent: scroller,
    ItemSeparatorComponent: separator,
    keyboardShouldPersistTaps: 'handled' as const,
    contentContainerStyle,
  }
}

export type ListProps<T> = FlatListProps<T> & ListExtras

export function List<T>({ refreshing, onRefresh, padded, keyboard, gap, footerBar, contentContainerStyle, ...rest }: ListProps<T>) {
  const base = useListProps({ refreshing, onRefresh, padded, keyboard, gap, footerBar })
  return <FlatList {...base} contentContainerStyle={[base.contentContainerStyle, contentContainerStyle]} {...rest} />
}

export type SectionedListProps<T, S> = SectionListProps<T, S> & ListExtras

export function SectionedList<T, S>({ refreshing, onRefresh, padded, keyboard, gap, footerBar, contentContainerStyle, ...rest }: SectionedListProps<T, S>) {
  const base = useListProps({ refreshing, onRefresh, padded, keyboard, gap, footerBar })
  return <SectionList stickySectionHeadersEnabled={false} {...base} contentContainerStyle={[base.contentContainerStyle, contentContainerStyle]} {...rest} />
}
