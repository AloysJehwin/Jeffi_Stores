import { useEffect, useState } from 'react'
import { ActivityIndicator, Linking, Pressable, View, type StyleProp, type ImageStyle } from 'react-native'
import { Image } from 'expo-image'
import { Download, File as FileIcon, FileText, Film, Music } from 'lucide-react-native'
import { Lightbox, Text, cn, toast } from '../../ui'
import { useTokens } from '../../theme'
import { resolveSupportFile } from '../../api/info'
import type { SupportAttachment } from '../../types/support'
import { fileSize } from './format'

const local = (url: string) => !url.startsWith('/')

// The attachment routes check the session and redirect to a signed S3 link. iOS can carry the
// Authorization header across that redirect, which S3 refuses, so resolve the link first and load it bare.
function Picture({ url, cacheKey, style, fit, label }: { url: string; cacheKey: string; style: StyleProp<ImageStyle>; fit: 'cover' | 'contain'; label?: string }) {
  const [uri, setUri] = useState<string | null>(local(url) ? url : null)
  useEffect(() => {
    if (local(url)) return setUri(url)
    let live = true
    resolveSupportFile(url).then(
      u => live && setUri(u),
      () => {}
    )
    return () => {
      live = false
    }
  }, [url])
  return uri ? <Image source={{ uri, cacheKey }} style={style} contentFit={fit} transition={150} accessibilityLabel={label} /> : <View style={style} />
}

function FileTile({ a, mine }: { a: SupportAttachment; mine: boolean }) {
  const t = useTokens()
  const [busy, setBusy] = useState(false)
  const Icon = a.kind === 'video' ? Film : a.kind === 'audio' ? Music : a.kind === 'pdf' || a.kind === 'doc' ? FileText : FileIcon
  const fg = mine ? '#ffffff' : t.foreground
  const type = a.kind === 'pdf' ? 'PDF' : a.kind === 'video' ? 'Video' : a.kind === 'audio' ? 'Audio' : a.mime.split('/')[1]?.toUpperCase().slice(0, 8) || 'File'
  const open = async () => {
    if (busy || local(a.url)) return
    setBusy(true)
    try {
      await Linking.openURL(await resolveSupportFile(a.url))
    } catch {
      toast.error("Couldn't open the file")
    } finally {
      setBusy(false)
    }
  }
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Open ${a.name}`}
      onPress={open}
      className={cn('min-w-0 flex-row items-center gap-2.5 rounded-lg border px-3 py-2', mine ? 'border-white/25 bg-white/10 active:bg-white/20' : 'border-border-default bg-surface active:bg-surface-secondary')}
    >
      <Icon size={20} color={fg} />
      <View className="min-w-0 flex-1">
        <Text numberOfLines={1} className={cn('text-xs font-medium', mine ? 'text-white' : 'text-foreground')}>
          {a.name}
        </Text>
        <Text className={cn('text-[10px]', mine ? 'text-white/75' : 'text-foreground-muted')}>
          {type} · {fileSize(a.size)}
        </Text>
      </View>
      {busy ? <ActivityIndicator size="small" color={fg} /> : <Download size={16} color={fg} opacity={0.7} />}
    </Pressable>
  )
}

/** A message's files: images (tap for full screen) and tiles for the rest (opened in the browser or player). */
export default function AttachmentView({ items, mine, width }: { items: SupportAttachment[]; mine: boolean; width: number }) {
  const [zoom, setZoom] = useState<SupportAttachment | null>(null)
  if (!items.length) return null
  const images = items.filter(a => a.kind === 'image')
  const rest = items.filter(a => a.kind !== 'image')
  const one = images.length === 1
  const cell = one ? width : Math.floor((width - 4) / 2)
  return (
    <View className="gap-1.5">
      {images.length > 0 ? (
        <View className="flex-row flex-wrap gap-1">
          {images.map(a => {
            const ratio = one && a.width && a.height ? a.width / a.height : 1
            const h = one ? Math.max(120, Math.min(320, Math.round(cell / ratio))) : cell
            return (
              <Pressable key={a.id} accessibilityRole="imagebutton" accessibilityLabel={a.name} onPress={() => setZoom(a)} className="overflow-hidden rounded-lg bg-black/5">
                <Picture url={a.thumbUrl ?? a.url} cacheKey={`support:${a.id}:${a.thumbUrl ? 't' : 'f'}`} style={{ width: cell, height: h }} fit="cover" />
              </Pressable>
            )
          })}
        </View>
      ) : null}
      {rest.map(a => (
        <FileTile key={a.id} a={a} mine={mine} />
      ))}
      {images.length > 0 ? (
        <Lightbox open={!!zoom} onClose={() => setZoom(null)}>
          {zoom ? <Picture url={zoom.url} cacheKey={`support:${zoom.id}:f`} style={{ flex: 1 }} fit="contain" label={zoom.name} /> : null}
        </Lightbox>
      ) : null}
    </View>
  )
}
