import { useRef, useState } from 'react'
import { ActivityIndicator, Platform, Pressable, ScrollView, TextInput, View } from 'react-native'
import Animated, { useAnimatedStyle } from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useReanimatedKeyboardAnimation } from 'react-native-keyboard-controller'
import { Image } from 'expo-image'
import * as ImagePicker from 'expo-image-picker'
import * as DocumentPicker from 'expo-document-picker'
import { Camera, File as FileIcon, FileText, Film, ImageIcon, Paperclip, SendHorizontal, X } from 'lucide-react-native'
import { IconButton, ListGroup, ListRow, ModalSheet, Text, cn, toast } from '../../ui'
import { useTokens } from '../../theme'
import { SUPPORT_MAX_BYTES } from '../../api/info'
import type { AttachmentKind, SupportUpload } from '../../types/support'
import type { PickedFile, ReadyAttachment } from './useSupportChat'
import { fileSize, kindOf } from './format'

type Picked = PickedFile & { size: number | null }

interface Pending {
  key: string
  name: string
  size: number | null
  kind: AttachmentKind
  localUri: string
  progress: number
  ready?: ReadyAttachment
  error?: string
}

interface Props {
  onSend: (text: string, attachments: ReadyAttachment[]) => void
  /** Without it there's no attach button (no chat yet, or a closed one). */
  upload?: (file: PickedFile, onProgress: (pct: number) => void) => Promise<SupportUpload>
  onTyping?: () => void
  disabled?: boolean
  placeholder?: string
  maxFiles?: number
}

const LINE = 21
const MAX_INPUT = LINE * 6 + 20

const extOf = (uri: string, mime: string) => /\.([a-z0-9]{2,5})$/i.exec(uri.split('?')[0])?.[1] ?? (mime.split('/')[1] === 'jpeg' ? 'jpg' : mime.split('/')[1] || 'bin')

function fromAsset(a: ImagePicker.ImagePickerAsset): Picked {
  const type = a.mimeType || (a.type === 'video' ? 'video/mp4' : 'image/jpeg')
  return { uri: a.uri, name: a.fileName || `${a.type === 'video' ? 'video' : 'photo'}-${Date.now()}.${extOf(a.uri, type)}`, type, size: a.fileSize ?? null }
}

type Source = 'library' | 'camera' | 'document'

/** The message box pinned above the keyboard: grows to six lines, takes photos, camera shots and documents. */
export default function Composer({ onSend, upload, onTyping, disabled, placeholder = 'Type a message', maxFiles = 10 }: Props) {
  const t = useTokens()
  const insets = useSafeAreaInsets()
  const { progress: keyboard } = useReanimatedKeyboardAnimation()
  const pad = useAnimatedStyle(() => ({ paddingBottom: 8 + insets.bottom * (1 - keyboard.value) }))
  const [text, setText] = useState('')
  const [pending, setPending] = useState<Pending[]>([])
  const [sheet, setSheet] = useState(false)
  const choice = useRef<Source | null>(null)
  const input = useRef<TextInput>(null)

  const room = Math.max(0, maxFiles - pending.length)

  const addFiles = (files: Picked[]) => {
    if (!upload) return
    for (const f of files.slice(0, room)) {
      if (f.size != null && f.size > SUPPORT_MAX_BYTES) {
        toast.error(`${f.name} is over 25 MB`)
        continue
      }
      const key = `${Date.now()}-${Math.random().toString(36).slice(2)}`
      const kind = kindOf(f.type, f.name)
      setPending(p => [...p, { key, name: f.name, size: f.size, kind, localUri: f.uri, progress: 0 }])
      upload(f, pct => setPending(p => p.map(x => (x.key === key ? { ...x, progress: pct } : x))))
        .then(ready => setPending(p => p.map(x => (x.key === key ? { ...x, progress: 100, ready: { ...ready, localUri: f.uri } } : x))))
        .catch(err => setPending(p => p.map(x => (x.key === key ? { ...x, error: err instanceof Error ? err.message : 'Upload failed' } : x))))
    }
  }

  const pick = async (source: Source) => {
    try {
      if (source === 'document') {
        const r = await DocumentPicker.getDocumentAsync({ multiple: true, copyToCacheDirectory: true })
        if (!r.canceled) addFiles(r.assets.map(a => ({ uri: a.uri, name: a.name, type: a.mimeType || 'application/octet-stream', size: a.size ?? null })))
        return
      }
      if (source === 'camera') {
        const perm = await ImagePicker.requestCameraPermissionsAsync()
        if (!perm.granted) {
          toast.error('Allow camera access in Settings to take a photo')
          return
        }
        const r = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.8 })
        if (!r.canceled) addFiles(r.assets.map(fromAsset))
        return
      }
      const r = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images', 'videos'],
        allowsMultipleSelection: true,
        selectionLimit: room,
        quality: 0.8,
        preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible,
      })
      if (!r.canceled) addFiles(r.assets.map(fromAsset))
    } catch {
      toast.error("Couldn't open that")
    }
  }

  // The picker opens once the sheet has gone (iOS can't present over a closing modal).
  const choose = (s: Source) => {
    choice.current = s
    setSheet(false)
  }

  const uploading = pending.some(p => !p.ready && !p.error)
  const ready = pending.filter(p => p.ready).map(p => p.ready!)
  const canSend = !disabled && !uploading && (!!text.trim() || ready.length > 0)

  const send = () => {
    if (!canSend) return
    onSend(text.trim(), ready)
    setText('')
    setPending([])
  }

  return (
    <Animated.View style={pad} className="border-t border-border-default bg-surface-elevated px-2 pt-2">
      {pending.length > 0 ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: 10, paddingHorizontal: 6, paddingTop: 6, paddingBottom: 8 }}>
          {pending.map(p => {
            const Icon = p.kind === 'video' ? Film : p.kind === 'pdf' || p.kind === 'doc' ? FileText : FileIcon
            return (
              <View key={p.key} className="w-[68px]">
                <View className="h-[68px] w-[68px] items-center justify-center overflow-hidden rounded-lg border border-border-default bg-surface-secondary">
                  {p.kind === 'image' ? <Image source={{ uri: p.localUri }} style={{ width: 68, height: 68 }} contentFit="cover" /> : <Icon size={24} color={t.foregroundMuted} />}
                  {!p.ready && !p.error ? (
                    p.progress > 0 && p.progress < 100 ? (
                      <View className="absolute bottom-1 left-1 right-1 h-1 overflow-hidden rounded bg-black/20">
                        <View className="h-full bg-accent-500" style={{ width: `${p.progress}%` }} />
                      </View>
                    ) : (
                      <View className="absolute inset-0 items-center justify-center bg-black/25">
                        <ActivityIndicator size="small" color="#ffffff" />
                      </View>
                    )
                  ) : null}
                  {p.error ? (
                    <View className="absolute inset-0 items-center justify-center bg-red-600/85 p-1">
                      <Text numberOfLines={3} className="text-center text-[10px] leading-3 text-white">
                        {p.error}
                      </Text>
                    </View>
                  ) : null}
                </View>
                <Text numberOfLines={1} className="mt-0.5 text-[10px] text-foreground-muted">
                  {p.size != null ? `${fileSize(p.size)} · ` : ''}
                  {p.name}
                </Text>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Remove ${p.name}`}
                  hitSlop={8}
                  onPress={() => setPending(x => x.filter(y => y.key !== p.key))}
                  className="absolute -right-1.5 -top-1.5 h-5 w-5 items-center justify-center rounded-full bg-foreground"
                >
                  <X size={12} color={t.surface} strokeWidth={3} />
                </Pressable>
              </View>
            )
          })}
        </ScrollView>
      ) : null}
      <View className="flex-row items-end gap-1">
        {upload ? <IconButton icon={Paperclip} label="Attach" disabled={disabled || room === 0} onPress={() => setSheet(true)} color={t.foregroundSecondary} /> : <View className="w-1" />}
        <TextInput
          ref={input}
          value={text}
          onChangeText={v => {
            setText(v)
            if (v) onTyping?.()
          }}
          editable={!disabled}
          multiline
          placeholder={placeholder}
          placeholderTextColor={t.foregroundMuted}
          accessibilityLabel="Message"
          textAlignVertical="center"
          style={{ maxHeight: MAX_INPUT, minHeight: 44, paddingTop: Platform.OS === 'ios' ? 11 : 8, paddingBottom: Platform.OS === 'ios' ? 11 : 8 }}
          className={cn('flex-1 rounded-3xl border border-border-default bg-surface px-4 font-inter text-[15px] text-foreground', disabled && 'opacity-60')}
        />
        <IconButton icon={SendHorizontal} label="Send" variant="solid" disabled={!canSend} onPress={send} />
      </View>

      <ModalSheet
        open={sheet}
        onClose={() => {
          choice.current = null
          setSheet(false)
        }}
        onClosed={() => {
          const s = choice.current
          choice.current = null
          if (s) pick(s)
        }}
        title="Attach"
      >
        <ListGroup className="mb-2">
          <ListRow icon={ImageIcon} title="Photo or video" subtitle="From your gallery" onPress={() => choose('library')} />
          <ListRow icon={Camera} title="Camera" subtitle="Take a photo" onPress={() => choose('camera')} />
          <ListRow icon={FileText} title="Document" subtitle="PDF, Word, Excel and more, up to 25 MB" onPress={() => choose('document')} />
        </ListGroup>
      </ModalSheet>
    </Animated.View>
  )
}
