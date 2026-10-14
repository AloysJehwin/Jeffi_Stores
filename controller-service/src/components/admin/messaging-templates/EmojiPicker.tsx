'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Search } from 'lucide-react'

type Emoji = { emoji: string; name: string }
type Group = { name: string; slug: string; emojis: Emoji[] }

const RECENT_KEY = 'jeffi:emoji-recent'
const GROUP_ICON: Record<string, string> = {
  smileys_emotion: '😀', people_body: '👋', animals_nature: '🌿', food_drink: '🍔', travel_places: '✈️',
  activities: '⚽', objects: '💡', symbols: '✅', flags: '🏳️',
}

let cache: Promise<Group[]> | null = null
const loadGroups = () => (cache ??= import('unicode-emoji-json/data-by-group.json').then(m => (m.default ?? m) as Group[]))

function readRecent(): string[] {
  try { return JSON.parse(localStorage.getItem(RECENT_KEY) || '[]') } catch { return [] }
}

export default function EmojiPicker({ onPick, onClose }: { onPick: (e: string) => void; onClose: () => void }) {
  const [groups, setGroups] = useState<Group[] | null>(null)
  const [q, setQ] = useState('')
  const [tab, setTab] = useState('recent')
  const [recent, setRecent] = useState<string[]>([])
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    loadGroups().then(setGroups)
    const r = readRecent()
    setRecent(r)
    if (!r.length) setTab('smileys_emotion')
  }, [])

  useEffect(() => {
    // The toggle button handles its own click; ignore it here or it would close-then-reopen.
    const out = (e: MouseEvent) => {
      const t = e.target as HTMLElement
      if (ref.current && !ref.current.contains(t) && !t.closest('[data-emoji-toggle]')) onClose()
    }
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('mousedown', out)
    document.addEventListener('keydown', esc)
    return () => { document.removeEventListener('mousedown', out); document.removeEventListener('keydown', esc) }
  }, [onClose])

  const shown = useMemo<Emoji[]>(() => {
    if (!groups) return []
    const needle = q.trim().toLowerCase()
    if (needle) return groups.flatMap(g => g.emojis).filter(e => e.name.includes(needle)).slice(0, 240)
    if (tab === 'recent') return recent.map(e => ({ emoji: e, name: '' }))
    return groups.find(g => g.slug === tab)?.emojis ?? []
  }, [groups, q, tab, recent])

  function pick(e: string) {
    const next = [e, ...recent.filter(x => x !== e)].slice(0, 32)
    setRecent(next)
    try { localStorage.setItem(RECENT_KEY, JSON.stringify(next)) } catch {}
    onPick(e)
  }

  return (
    <div ref={ref} className="absolute z-30 mt-2 w-80 bg-surface-elevated border border-border-default rounded-xl shadow-xl animate-fade-in">
      <div className="p-2 border-b border-border-default">
        <div className="relative">
          <Search className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-foreground-muted" />
          <input
            autoFocus
            value={q}
            onChange={e => setQ(e.target.value)}
            placeholder="Search emoji"
            className="w-full pl-8 pr-3 py-1.5 text-sm border border-border-secondary rounded-lg bg-surface text-foreground placeholder:text-foreground-muted focus:outline-none focus:ring-2 focus:ring-accent-500 focus:border-transparent"
          />
        </div>
      </div>
      {!q && (
        <div className="flex px-1 border-b border-border-default overflow-x-auto">
          {[{ slug: 'recent', icon: '🕘' }, ...(groups ?? []).map(g => ({ slug: g.slug, icon: GROUP_ICON[g.slug] ?? g.emojis[0]?.emoji }))].map(t => (
            <button
              key={t.slug}
              type="button"
              title={t.slug.replace(/_/g, ' ')}
              onClick={() => setTab(t.slug)}
              className={`px-2 py-1.5 text-base border-b-2 -mb-px transition-colors ${tab === t.slug ? 'border-accent-500' : 'border-transparent opacity-60 hover:opacity-100'}`}
            >
              {t.icon}
            </button>
          ))}
        </div>
      )}
      <div className="h-56 overflow-y-auto p-2">
        {!groups && (
          <div className="grid grid-cols-8 gap-1">
            {Array.from({ length: 40 }).map((_, i) => <div key={i} className="h-8 rounded-md bg-surface-secondary animate-pulse" />)}
          </div>
        )}
        {groups && shown.length === 0 && (
          <p className="py-10 text-center text-xs text-foreground-muted">{q ? 'No emoji found' : 'Recently used emoji show up here'}</p>
        )}
        {groups && shown.length > 0 && (
          <div className="grid grid-cols-8 gap-1">
            {shown.map(e => (
              <button key={e.emoji} type="button" title={e.name} onClick={() => pick(e.emoji)} className="h-8 text-xl rounded-md hover:bg-surface-secondary transition-colors">
                {e.emoji}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
