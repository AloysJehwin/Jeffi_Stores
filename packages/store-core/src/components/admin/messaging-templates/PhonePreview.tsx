'use client'

import { ExternalLink, Phone, Reply, ChevronLeft, Video, MoreVertical, Info } from 'lucide-react'
import type { WaButton, WaCarouselCard } from './TemplateEditor'

// Live phone mock for SMS / WhatsApp templates: what the customer's handset shows, built from the
// editor state (no save needed). Variables render as their sample value, or as a highlighted token.

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const TOKEN = /\{\{?\s*([a-zA-Z0-9_]+)\s*\}?\}/g
const URL_RE = /(https?:\/\/[^\s<]+)/g

function fill(text: string, vars: Record<string, string>, linkColor: string) {
  let html = esc(text || '')
  html = html.replace(TOKEN, (_m, k: string) =>
    vars[k] ? esc(vars[k]) : `<span style="background:rgba(196,106,70,.15);color:#a9552f;border-radius:4px;padding:0 3px">${esc(k)}</span>`)
  return html.replace(URL_RE, u => `<span style="color:${linkColor};text-decoration:underline">${u}</span>`)
}

// WhatsApp markdown: *bold* _italic_ ~strike~ ```mono```.
const waFormat = (html: string) =>
  html
    .replace(/```([\s\S]+?)```/g, '<code style="font-family:ui-monospace,monospace">$1</code>')
    .replace(/(^|\s)\*([^*\n]+)\*/g, '$1<b>$2</b>')
    .replace(/(^|\s)_([^_\n]+)_/g, '$1<i>$2</i>')
    .replace(/(^|\s)~([^~\n]+)~/g, '$1<s>$2</s>')

const ICON = { url: ExternalLink, phone: Phone, quick_reply: Reply } as const
const isImage = (u: string) => /\.(png|jpe?g|gif|webp|avif)(\?|$)/i.test(u)

function Media({ url, className }: { url: string; className: string }) {
  return isImage(url)
    // eslint-disable-next-line @next/next/no-img-element
    ? <img src={url} alt="" className={`${className} object-cover`} />
    : <div className={`${className} flex items-center justify-center bg-[#d1d7db] text-[11px] text-[#54656f]`}>{url.split('/').pop()?.slice(0, 28)}</div>
}

function ActionRows({ buttons }: { buttons: WaButton[] }) {
  return (
    <>
      {buttons.map((b, i) => {
        const Icon = ICON[b.type] ?? ExternalLink
        return (
          <div key={i} className="flex items-center justify-center gap-1.5 border-t border-[#e9edef] py-2 text-[13px] font-medium text-[#027eb5]">
            <Icon className="w-3.5 h-3.5" /> {b.label || 'Button'}
          </div>
        )
      })}
    </>
  )
}

export default function PhonePreview({
  channel, body, vars = {}, headerMedia, buttons = [], cards = [], brand = 'Your store',
}: {
  channel: 'sms' | 'whatsapp'
  body: string
  vars?: Record<string, string>
  headerMedia?: string | null
  buttons?: WaButton[]
  cards?: WaCarouselCard[]
  brand?: string
}) {
  const time = '10:24'
  const initial = (brand.trim()[0] || 'S').toUpperCase()

  if (channel === 'sms') {
    return (
      <div className="mx-auto w-full max-w-[340px] overflow-hidden rounded-[2rem] border-[6px] border-zinc-900 bg-white shadow-xl">
        <div className="flex flex-col items-center gap-1 border-b border-zinc-200 bg-zinc-50 px-3 pt-3 pb-2">
          <div className="flex w-full items-center justify-between text-[#007aff]"><ChevronLeft className="w-5 h-5" /><Info className="w-4 h-4" /></div>
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-b from-zinc-400 to-zinc-500 text-sm font-semibold text-white">{initial}</div>
          <div className="text-[11px] text-zinc-700">{brand}</div>
        </div>
        <div className="min-h-[260px] space-y-1 bg-white px-3 py-4">
          <p className="pb-2 text-center text-[10px] text-zinc-400">Text Message · Today {time}</p>
          <div className="max-w-[80%] whitespace-pre-wrap break-words rounded-[18px] rounded-bl-[4px] bg-[#e9e9eb] px-3 py-2 text-[14px] leading-snug text-black"
            dangerouslySetInnerHTML={{ __html: fill(body, vars, '#007aff') || '&nbsp;' }} />
        </div>
      </div>
    )
  }

  const quick = buttons.filter(b => b.type === 'quick_reply')
  const actions = buttons.filter(b => b.type !== 'quick_reply')
  return (
    <div className="mx-auto w-full max-w-[340px] overflow-hidden rounded-[2rem] border-[6px] border-zinc-900 shadow-xl">
      <div className="flex items-center gap-2 bg-[#008069] px-3 py-2.5 text-white">
        <ChevronLeft className="w-5 h-5 shrink-0" />
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/25 text-sm font-semibold">{initial}</div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[14px] font-semibold leading-tight">{brand}</div>
          <div className="text-[10px] opacity-80">Business account</div>
        </div>
        <Video className="w-4 h-4" /><Phone className="w-4 h-4" /><MoreVertical className="w-4 h-4" />
      </div>
      <div className="min-h-[300px] space-y-1.5 bg-[#efeae2] px-2.5 py-3" style={{ backgroundImage: 'radial-gradient(rgba(0,0,0,.035) 1px, transparent 1px)', backgroundSize: '14px 14px' }}>
        <div className="mx-auto mb-2 w-fit rounded-md bg-white/90 px-2 py-0.5 text-[10px] text-[#54656f] shadow-sm">TODAY</div>
        <div className="max-w-[88%] overflow-hidden rounded-lg rounded-tl-none bg-white shadow-sm">
          {headerMedia && <div className="p-1"><Media url={headerMedia} className="h-36 w-full rounded-md" /></div>}
          <div className="px-2.5 pt-1.5 pb-1">
            <div className="whitespace-pre-wrap break-words text-[14px] leading-snug text-[#111b21]"
              dangerouslySetInnerHTML={{ __html: waFormat(fill(body, vars, '#027eb5')) || '&nbsp;' }} />
            <div className="mt-0.5 flex items-center justify-end gap-1 text-[10px] text-[#667781]">{time}</div>
          </div>
          <ActionRows buttons={actions} />
        </div>
        {quick.length > 0 && (
          <div className="flex max-w-[88%] flex-col gap-1">
            {quick.map((b, i) => (
              <div key={i} className="flex items-center justify-center gap-1.5 rounded-lg bg-white py-2 text-[13px] font-medium text-[#027eb5] shadow-sm">
                <Reply className="w-3.5 h-3.5" /> {b.label || 'Reply'}
              </div>
            ))}
          </div>
        )}
        {cards.length > 0 && (
          <div className="-mx-2.5 flex snap-x snap-mandatory gap-2 overflow-x-auto px-2.5 pb-1">
            {cards.map((c, i) => (
              <div key={i} className="w-[220px] shrink-0 snap-start overflow-hidden rounded-lg bg-white shadow-sm">
                {c.media_url ? <Media url={c.media_url} className="h-28 w-full" /> : <div className="h-28 w-full bg-[#d1d7db]" />}
                <div className="px-2.5 py-2">
                  {c.title && <div className="text-[13px] font-semibold text-[#111b21]" dangerouslySetInnerHTML={{ __html: fill(c.title, vars, '#027eb5') }} />}
                  {c.body && <div className="mt-0.5 whitespace-pre-wrap text-[12px] leading-snug text-[#3b4a54]" dangerouslySetInnerHTML={{ __html: waFormat(fill(c.body, vars, '#027eb5')) }} />}
                </div>
                <ActionRows buttons={c.buttons ?? []} />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
