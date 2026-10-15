import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Font } from '@react-pdf/renderer'
import type { FontKey } from './model.js'

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../fonts')
const f = (file: string) => path.join(dir, file)

let registered = false
export function registerFonts() {
  if (registered) return
  registered = true
  Font.register({ family: 'Inter', fonts: [{ src: f('Inter_400Regular.ttf') }, { src: f('Inter_600SemiBold.ttf'), fontWeight: 600 }, { src: f('Inter_700Bold.ttf'), fontWeight: 700 }] })
  Font.register({ family: 'DMSans', fonts: [{ src: f('DMSans_400Regular.ttf') }, { src: f('DMSans_500Medium.ttf'), fontWeight: 600 }, { src: f('DMSans_700Bold.ttf'), fontWeight: 700 }] })
  Font.register({ family: 'Lora', fonts: [{ src: f('Lora_400Regular.ttf') }, { src: f('Lora_400Regular_Italic.ttf'), fontStyle: 'italic' }, { src: f('Lora_700Bold.ttf'), fontWeight: 700 }, { src: f('Lora_700Bold.ttf'), fontWeight: 600 }] })
  Font.register({ family: 'Playfair', fonts: [{ src: f('PlayfairDisplay_400Regular.ttf') }, { src: f('PlayfairDisplay_700Bold.ttf'), fontWeight: 700 }, { src: f('PlayfairDisplay_700Bold.ttf'), fontWeight: 600 }, { src: f('PlayfairDisplay_900Black.ttf'), fontWeight: 900 }] })
  Font.register({ family: 'PlexSans', fonts: [{ src: f('IBMPlexSans_400Regular.ttf') }, { src: f('IBMPlexSans_600SemiBold.ttf'), fontWeight: 600 }, { src: f('IBMPlexSans_600SemiBold.ttf'), fontWeight: 700 }] })
  Font.register({ family: 'Mono', fonts: [{ src: f('RobotoMono_400Regular.ttf') }, { src: f('RobotoMono_600SemiBold.ttf'), fontWeight: 600 }, { src: f('RobotoMono_600SemiBold.ttf'), fontWeight: 700 }] })
  Font.register({ family: 'NotoSans', fonts: [{ src: f('NotoSans-Regular.ttf') }, { src: f('NotoSans-Italic.ttf'), fontStyle: 'italic' }, { src: f('NotoSans-Bold.ttf'), fontWeight: 700 }, { src: f('NotoSans-Bold.ttf'), fontWeight: 600 }] })
  // Words are never hyphenated mid-word in documents.
  Font.registerHyphenationCallback(word => [word])
}

// Body fonts all carry ₹ (Lora doesn't, so it is only ever a heading face).
export const FONT_PAIRINGS: Record<FontKey, { label: string; head: string; body: string; mono: string }> = {
  modern: { label: 'Modern — Inter', head: 'Inter', body: 'Inter', mono: 'Mono' },
  geometric: { label: 'Geometric — DM Sans', head: 'DMSans', body: 'DMSans', mono: 'Mono' },
  classic: { label: 'Classic — Lora + Inter', head: 'Lora', body: 'Inter', mono: 'Mono' },
  editorial: { label: 'Editorial — Playfair + Inter', head: 'Playfair', body: 'Inter', mono: 'Mono' },
  technical: { label: 'Technical — IBM Plex', head: 'PlexSans', body: 'PlexSans', mono: 'Mono' },
  system: { label: 'System — Noto Sans', head: 'NotoSans', body: 'NotoSans', mono: 'Mono' },
}
export const FONT_KEYS = Object.keys(FONT_PAIRINGS) as FontKey[]
