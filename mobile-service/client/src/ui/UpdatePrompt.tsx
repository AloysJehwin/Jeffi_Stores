import { useCallback, useEffect, useRef, useState } from 'react'
import { AppState, Linking, Platform, View } from 'react-native'
import Animated, { FadeInDown, FadeOutDown } from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useQuery } from '@tanstack/react-query'
import AsyncStorage from '@react-native-async-storage/async-storage'
import * as Updates from 'expo-updates'
import * as InAppUpdates from 'expo-in-app-updates'
import { X } from 'lucide-react-native'
import { appConfigQuery, isOlderVersion } from '../api/appConfig'
import { appVersion } from '../lib/appVersion'
import { useTokens } from '../theme'
import { Button, IconButton } from './Button'
import { Caption, Text } from './Text'
import { cn } from './cn'
import { elevationClass, useElevation } from './elevation'
import { useMotion } from './motion'

// Tells the user when a newer version exists, from three sources:
//  - Google Play: a newer build on the store (in-app update API, so the Play flow does the install);
//  - EAS Update: a JavaScript update already downloaded in the background, applied by a restart;
//  - the backend's MIN_APP_VERSION: this build is too old to keep using (no dismiss).
// A dismissed offer stays quiet for SNOOZE_MS, then comes back.

const PACKAGE = 'com.jeffistores.app'
const STORE_URL = Platform.select({ android: `market://details?id=${PACKAGE}`, default: null })
const STORE_WEB = `https://play.google.com/store/apps/details?id=${PACKAGE}`
const SNOOZE_MS = 3 * 24 * 60 * 60 * 1000
const RECHECK_MS = 30 * 60 * 1000
const snoozeKey = (key: string) => `update.snoozed.${key}`

type Offer = { kind: 'store'; key: string; required: boolean } | { kind: 'ota'; key: string }

const COPY = {
  store: { title: 'A new version is available', body: 'Update for the latest fixes and features.', action: 'Update' },
  required: { title: 'Please update the app', body: "This version is no longer supported. Update to keep shopping.", action: 'Update' },
  ota: { title: 'An update is ready', body: 'Restart the app to finish updating. It only takes a second.', action: 'Restart' },
}

async function snoozed(key: string): Promise<boolean> {
  const at = Number(await AsyncStorage.getItem(snoozeKey(key)).catch(() => null))
  return !!at && Date.now() - at < SNOOZE_MS
}

/** A newer build on Google Play, or null (also null for installs Play doesn't own: debug, sideloaded). */
async function playUpdate(): Promise<{ key: string } | null> {
  if (Platform.OS !== 'android' || __DEV__) return null
  try {
    const r = await InAppUpdates.checkForUpdate()
    if (!r.updateAvailable) return null
    return { key: `play-${r.storeVersion ?? 'new'}` }
  } catch {
    return null
  }
}

/** Downloads a pending EAS Update in the background; the hook below sees it once it is ready. */
async function fetchOtaUpdate(): Promise<void> {
  if (__DEV__ || !Updates.isEnabled) return
  try {
    const r = await Updates.checkForUpdateAsync()
    if (r.isAvailable) await Updates.fetchUpdateAsync()
  } catch {}
}

export default function UpdatePrompt() {
  const insets = useSafeAreaInsets()
  const t = useTokens()
  const shadow = useElevation('floating')
  const { animate } = useMotion()
  const { data: config } = useQuery(appConfigQuery)
  const { isUpdatePending, downloadedUpdate } = Updates.useUpdates()
  const [play, setPlay] = useState<{ key: string } | null>(null)
  const [offer, setOffer] = useState<Offer | null>(null)
  const [busy, setBusy] = useState(false)
  const lastCheck = useRef(0)

  const check = useCallback(async () => {
    if (Date.now() - lastCheck.current < RECHECK_MS) return
    lastCheck.current = Date.now()
    setPlay(await playUpdate())
    void fetchOtaUpdate()
  }, [])

  useEffect(() => {
    void check()
    const sub = AppState.addEventListener('change', s => s === 'active' && void check())
    return () => sub.remove()
  }, [check])

  const required = !!config && isOlderVersion(appVersion().version, config.min_app_version)
  useEffect(() => {
    let live = true
    ;(async () => {
      let next: Offer | null = null
      if (required) next = { kind: 'store', key: 'required', required: true }
      else if (play) next = { kind: 'store', key: play.key, required: false }
      else if (isUpdatePending) next = { kind: 'ota', key: `ota-${downloadedUpdate?.updateId ?? 'pending'}` }
      if (next && !(next.kind === 'store' && next.required) && (await snoozed(next.key))) next = null
      if (live) setOffer(next)
    })()
    return () => {
      live = false
    }
  }, [required, play, isUpdatePending, downloadedUpdate?.updateId])

  if (!offer) return null
  const copy = offer.kind === 'ota' ? COPY.ota : offer.required ? COPY.required : COPY.store
  const dismissible = !(offer.kind === 'store' && offer.required)

  const act = async () => {
    setBusy(true)
    try {
      if (offer.kind === 'ota') {
        await Updates.reloadAsync()
        return
      }
      // Play's own flow when Play owns this install; otherwise the store listing.
      const started = Platform.OS === 'android' ? await InAppUpdates.startUpdate(offer.required).catch(() => false) : false
      if (!started) await Linking.openURL(STORE_URL ?? STORE_WEB).catch(() => Linking.openURL(STORE_WEB))
    } finally {
      setBusy(false)
    }
  }
  const dismiss = () => {
    void AsyncStorage.setItem(snoozeKey(offer.key), String(Date.now())).catch(() => {})
    setOffer(null)
  }

  return (
    <View pointerEvents="box-none" style={{ position: 'absolute', left: 16, right: 16, bottom: insets.bottom + 132 }}>
      <Animated.View
        entering={animate ? FadeInDown.duration(220) : undefined}
        exiting={animate ? FadeOutDown.duration(160) : undefined}
        style={shadow}
        className={cn('flex-row items-center gap-3 rounded-panel bg-surface-elevated py-3 pl-4 pr-2', elevationClass('floating'))}
      >
        <View className="flex-1">
          <Text className="text-sm font-semibold">{copy.title}</Text>
          <Caption className="text-foreground-secondary">{copy.body}</Caption>
        </View>
        <Button label={copy.action} size="sm" block={false} loading={busy} onPress={() => void act()} />
        {dismissible ? <IconButton icon={X} label="Not now" size="sm" color={t.foregroundMuted} onPress={dismiss} /> : <View className="w-2" />}
      </Animated.View>
    </View>
  )
}
