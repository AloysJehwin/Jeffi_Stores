import { useEffect, useRef, useState } from 'react'
import { AppState, View, type StyleProp, type ViewStyle } from 'react-native'
import { requireOptionalNativeModule, useEventListener } from 'expo'
import { Image } from 'expo-image'
import { absUrl } from '../lib/links'
import { useMotion, useScreenReader } from './motion'

// A picture, or a muted looping clip over it as its poster. Binaries built before expo-video have no
// ExpoVideo native module and the package throws on import there, so it is required only once the module is found.

type ExpoVideo = typeof import('expo-video')
let mod: ExpoVideo | null | undefined
function expoVideo(): ExpoVideo | null {
  if (mod === undefined) {
    try {
      mod = requireOptionalNativeModule('ExpoVideo') ? (require('expo-video') as ExpoVideo) : null
    } catch {
      mod = null
    }
  }
  return mod
}

const FILL = { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 } as const

export type MediaFit = 'cover' | 'contain' | 'fill'

export interface MediaProps {
  image: string | null | undefined
  /** MP4/WebM drawn over `image`, its poster. */
  video?: string | null
  blurhash?: string | null
  contentFit?: MediaFit
  /** The box; poster and clip fill it. */
  style?: StyleProp<ViewStyle>
  /** The clip plays only while true (the page on show); otherwise its player is released. */
  active?: boolean
  /** Holds a playing clip, e.g. a finger down on a story. */
  paused?: boolean
  loop?: boolean
  transition?: number
  accessibilityLabel?: string
  /** True from the clip's first frame until it stops showing. */
  onPlaying?: (playing: boolean) => void
  /** The clip's length in seconds, once it loads. */
  onDuration?: (seconds: number) => void
  /** The clip failed; the poster stays. */
  onError?: () => void
}

/** Whether a clip may play: the native module is in this build, motion is allowed and no screen reader is on. */
export function useVideoAllowed() {
  const { animate } = useMotion()
  const reader = useScreenReader()
  return animate && !reader && !!expoVideo()
}

export function Media(props: MediaProps) {
  const { image, video, blurhash, contentFit = 'cover', style, transition = 200, accessibilityLabel } = props
  const src = absUrl(image)
  const uri = absUrl(video)
  return (
    <View
      pointerEvents="none"
      style={style}
      {...(accessibilityLabel ? { accessible: true, accessibilityRole: 'image' as const, accessibilityLabel } : null)}
    >
      <Image
        source={src ? { uri: src } : undefined}
        placeholder={blurhash ? { blurhash } : undefined}
        style={FILL}
        contentFit={contentFit}
        transition={transition}
      />
      {uri ? <ClipGate {...props} uri={uri} fit={contentFit} /> : null}
    </View>
  )
}

type ClipProps = MediaProps & { uri: string; fit: MediaFit }

function ClipGate({ active = true, ...rest }: ClipProps) {
  const allowed = useVideoAllowed()
  return allowed && active ? <Clip key={rest.uri} {...rest} /> : null
}

function useForeground() {
  const [on, setOn] = useState(AppState.currentState !== 'background')
  useEffect(() => {
    const sub = AppState.addEventListener('change', s => setOn(s === 'active'))
    return () => sub.remove()
  }, [])
  return on
}

function Clip({ uri, fit, paused = false, loop = true, onPlaying, onDuration, onError }: ClipProps) {
  const V = expoVideo()!
  const player = V.useVideoPlayer({ uri, useCaching: true }, p => {
    p.muted = true
    p.loop = loop
    p.keepScreenOnWhilePlaying = false
  })
  const foreground = useForeground()
  const [shown, setShown] = useState(false)
  const [failed, setFailed] = useState(false)
  const cb = useRef({ onPlaying, onDuration, onError })
  cb.current = { onPlaying, onDuration, onError }

  useEventListener(player, 'sourceLoad', ({ duration }) => {
    if (duration > 0 && Number.isFinite(duration)) cb.current.onDuration?.(duration)
  })
  useEventListener(player, 'statusChange', ({ status }) => {
    if (status !== 'error') return
    setFailed(true)
    cb.current.onError?.()
  })

  const run = foreground && !paused && !failed
  useEffect(() => {
    if (run) player.play()
    else player.pause()
  }, [player, run])

  const on = shown && !failed
  useEffect(() => {
    if (!on) return
    cb.current.onPlaying?.(true)
    return () => cb.current.onPlaying?.(false)
  }, [on])

  if (failed) return null
  // Hidden until its first frame so the poster shows through; a TextureView on Android follows the
  // card's clipping, fades and transforms.
  return (
    <View style={[FILL, { opacity: shown ? 1 : 0 }]} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
      <V.VideoView
        player={player}
        style={FILL}
        contentFit={fit}
        nativeControls={false}
        allowsPictureInPicture={false}
        surfaceType="textureView"
        onFirstFrameRender={() => setShown(true)}
      />
    </View>
  )
}
