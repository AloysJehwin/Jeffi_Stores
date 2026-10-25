import type { ReactNode } from 'react'
import { RefreshControl, ScrollView, View, type ScrollViewProps } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { ArrowLeft } from 'lucide-react-native'
import { useTokens } from '../theme'
import { Text, Title } from './Text'
import { IconButton, TextButton } from './Button'
import { ErrorState } from './States'
import { KeyboardScroll } from './KeyboardScroll'
import Spinner from './Spinner'
import { cn } from './cn'

// Every route renders through Screen: it owns the background, the header, the bottom safe area, pull to
// refresh and the loading / error / empty slots, so no screen pads for the nav bar by hand.

/** The content gutter (Screen's px-4); full-bleed rows pad by it. */
export const GUTTER = 16

/** Bottom padding that clears the system navigation bar (for lists a screen renders itself). */
export function useBottomInset(extra = 24) {
  return useSafeAreaInsets().bottom + extra
}

export interface ScreenProps {
  children?: ReactNode
  /** A ScreenHeader, the TopNav, or nothing. `title` is the short form of a ScreenHeader. */
  header?: ReactNode
  title?: string
  /**
   * scroll: a ScrollView (the default); keyboard: one that keeps the focused field above the keyboard;
   * none: a plain flex view for screens that render their own FlatList (pad it with useBottomInset).
   */
  mode?: 'scroll' | 'keyboard' | 'none'
  loading?: boolean
  /** Shown while loading; a shaped skeleton of the page. Defaults to a spinner. */
  skeleton?: ReactNode
  error?: unknown
  onRetry?: () => void
  /** Shown instead of the content when there's nothing to show. */
  empty?: ReactNode | false
  refreshing?: boolean
  onRefresh?: () => void
  /** A bar pinned to the bottom (checkout totals, "Add to cart"). */
  footer?: ReactNode
  /** Horizontal gutter on the content (default 16). */
  padded?: boolean
  contentClassName?: string
  background?: 'surface' | 'elevated'
  scrollProps?: ScrollViewProps
}

export function Screen({
  children,
  header,
  title,
  mode = 'scroll',
  loading,
  skeleton,
  error,
  onRetry,
  empty,
  refreshing = false,
  onRefresh,
  footer,
  padded = true,
  contentClassName,
  background = 'surface',
  scrollProps,
}: ScreenProps) {
  const t = useTokens()
  const insets = useSafeAreaInsets()
  const head = header ?? (title ? <ScreenHeader title={title} /> : null)
  const bottom = (footer ? 16 : insets.bottom) + 24

  let body: ReactNode = children
  if (loading) body = skeleton ?? <Spinner />
  else if (error) body = <ErrorState fill onRetry={onRetry} message={error instanceof Error && error.message ? error.message : undefined} />
  else if (empty) body = empty

  const refresh = onRefresh ? <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={t.accent500} colors={[t.accent500]} progressBackgroundColor={t.surfaceElevated} /> : undefined
  const content = cn(padded && 'px-4', 'pt-4', contentClassName)
  // Loading, error and empty states fill the screen and still allow pull to refresh.
  const fills = !!(loading || error || empty)

  return (
    <View className={cn('flex-1', background === 'elevated' ? 'bg-surface-elevated' : 'bg-surface')}>
      {head}
      {mode === 'none' ? (
        <View className="flex-1">{body}</View>
      ) : mode === 'keyboard' ? (
        <KeyboardScroll refreshControl={refresh} contentContainerStyle={{ paddingBottom: bottom, flexGrow: fills ? 1 : undefined }} {...scrollProps}>
          <View className={cn(content, fills && 'flex-1')}>{body}</View>
        </KeyboardScroll>
      ) : (
        <ScrollView refreshControl={refresh} keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: bottom, flexGrow: fills ? 1 : undefined }} {...scrollProps}>
          <View className={cn(content, fills && 'flex-1')}>{body}</View>
        </ScrollView>
      )}
      {footer ? <ScreenFooter>{footer}</ScreenFooter> : null}
    </View>
  )
}

/** The pinned bottom bar; clears the navigation bar. */
export function ScreenFooter({ children }: { children: ReactNode }) {
  const insets = useSafeAreaInsets()
  return (
    <View style={{ paddingBottom: insets.bottom + 12 }} className="border-t border-border-default bg-surface-elevated px-4 pt-3">
      {children}
    </View>
  )
}

export interface ScreenHeaderProps {
  title?: string
  subtitle?: string
  /** Show the back button (default true). */
  back?: boolean
  onBack?: () => void
  /** Up to two IconButtons. */
  actions?: ReactNode
  /** A large title under the bar, for top-level pages. */
  large?: boolean
}

export function ScreenHeader({ title, subtitle, back = true, onBack, actions, large }: ScreenHeaderProps) {
  const insets = useSafeAreaInsets()
  const router = useRouter()
  const goBack = onBack ?? (() => (router.canGoBack() ? router.back() : router.replace('/(tabs)')))
  return (
    <View style={{ paddingTop: insets.top }} className="border-b border-border-default bg-surface-elevated">
      <View className="h-14 flex-row items-center gap-1 px-2">
        {back ? <IconButton icon={ArrowLeft} label="Back" onPress={goBack} /> : <View className="w-2" />}
        <View className="flex-1 px-1">
          {!large && title ? (
            <Text accessibilityRole="header" numberOfLines={1} className="font-display text-lg font-extrabold text-foreground">
              {title}
            </Text>
          ) : null}
          {!large && subtitle ? (
            <Text numberOfLines={1} className="text-xs text-foreground-muted">
              {subtitle}
            </Text>
          ) : null}
        </View>
        {actions ? <View className="flex-row items-center">{actions}</View> : null}
      </View>
      {large && title ? (
        <View className="px-4 pb-4">
          <Title>{title}</Title>
          {subtitle ? <Text className="mt-1 text-sm text-foreground-secondary">{subtitle}</Text> : null}
        </View>
      ) : null}
    </View>
  )
}

/** A titled block of a page, with an optional "See all". */
export function Section({
  title,
  subtitle,
  actionLabel = 'See all',
  onAction,
  children,
  gutter = true,
  className,
}: {
  title?: string
  subtitle?: string
  actionLabel?: string
  onAction?: () => void
  children: ReactNode
  /** Indent the heading by the page gutter (for edge-to-edge content like carousels). */
  gutter?: boolean
  className?: string
}) {
  return (
    <View className={cn('mb-6', className)}>
      {title ? (
        <View className={cn('mb-3 flex-row items-end gap-3', gutter && 'px-4')}>
          <View className="flex-1">
            <Text accessibilityRole="header" className="font-display text-lg font-extrabold leading-6 text-foreground">
              {title}
            </Text>
            {subtitle ? <Text className="mt-0.5 text-[13px] text-foreground-muted">{subtitle}</Text> : null}
          </View>
          {onAction ? <TextButton label={actionLabel} onPress={onAction} /> : null}
        </View>
      ) : null}
      {children}
    </View>
  )
}
