'use client'

import { useCallback, useEffect, useState } from 'react'
import { ExternalLink, Star } from 'lucide-react'
import { useToast } from '@/contexts/ToastContext'
import { useCanWrite } from '@/contexts/AdminScopesContext'
import { Badge, Empty, Section, api, btnGhost, btnPrimary, inputCls, when } from '@/components/admin/channels/ui'

interface Item {
  id: string
  network: string
  kind: 'comment' | 'review'
  author: string | null
  text: string | null
  rating: number | null
  created_at: string | null
  replied_at: string | null
  reply_text: string | null
  reply_by: string | null
  post_caption: string | null
  post_permalink: string | null
}

const NETWORK_LABEL: Record<string, string> = {
  facebook: 'Facebook',
  instagram: 'Instagram',
  gbp: 'Business Profile',
  youtube: 'YouTube',
  pinterest: 'Pinterest',
  linkedin: 'LinkedIn',
  x: 'X',
}

function Stars({ n }: { n: number }) {
  return (
    <span className="inline-flex" aria-label={`${n} of 5 stars`}>
      {[1, 2, 3, 4, 5].map(i => (
        <Star key={i} className={`w-3.5 h-3.5 ${i <= n ? 'fill-amber-400 text-amber-400' : 'text-foreground-muted'}`} />
      ))}
    </span>
  )
}

export default function Inbox({ reloadKey }: { reloadKey: number }) {
  const canWrite = useCanWrite('social')
  const { showToast } = useToast()
  const [filter, setFilter] = useState<'open' | 'all'>('open')
  const [items, setItems] = useState<Item[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [replying, setReplying] = useState<string | null>(null)
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)

  const load = useCallback(async () => {
    setError(null)
    const r = await api<{ items: Item[] }>(`/api/admin/social/inbox?filter=${filter}`)
    if (r.ok) setItems(r.data.items ?? [])
    else setError(r.data.error || 'Could not load the inbox')
  }, [filter])
  useEffect(() => {
    load()
  }, [load, reloadKey])

  async function send(id: string) {
    setSending(true)
    const r = await api(`/api/admin/social/inbox/${id}`, { method: 'POST', json: { text: text.trim() } })
    setSending(false)
    if (!r.ok) return showToast(r.data.error || 'Reply failed', 'error')
    showToast('Reply sent', 'success')
    setReplying(null)
    setText('')
    load()
  }

  return (
    <Section
      title="Comments and reviews"
      action={
        <div className="flex gap-1 p-1 bg-surface border border-border-default rounded-lg">
          {(['open', 'all'] as const).map(f => (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              className={`px-3 py-1 text-xs font-medium rounded-md ${filter === f ? 'bg-accent-500 text-white' : 'text-foreground-muted hover:text-foreground'}`}
            >
              {f === 'open' ? 'Needs a reply' : 'All'}
            </button>
          ))}
        </div>
      }
    >
      {error ? (
        <p className="text-sm text-red-500">{error}</p>
      ) : !items ? (
        <p className="text-sm text-foreground-muted">Loading...</p>
      ) : !items.length ? (
        <Empty msg={filter === 'open' ? 'Everything has a reply.' : 'No comments or reviews collected yet.'} />
      ) : (
        <ul className="space-y-2">
          {items.map(it => (
            <li key={it.id} className="rounded-lg border border-border-default p-3 space-y-1.5">
              <div className="flex items-center gap-2 flex-wrap text-sm">
                <Badge tone="blue">{NETWORK_LABEL[it.network] ?? it.network}</Badge>
                <Badge>{it.kind}</Badge>
                <span className="font-medium">{it.author ?? 'Someone'}</span>
                {it.kind === 'review' && it.rating != null && <Stars n={it.rating} />}
                <span className="text-xs text-foreground-muted ml-auto">{when(it.created_at)}</span>
              </div>
              {it.text && <p className="text-sm whitespace-pre-line">{it.text}</p>}
              {it.post_caption && (
                <p className="text-xs text-foreground-muted truncate">
                  On: {it.post_caption}
                  {it.post_permalink && (
                    <a
                      href={it.post_permalink}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-0.5 ml-1 text-accent-500 hover:underline"
                    >
                      view <ExternalLink className="w-3 h-3" />
                    </a>
                  )}
                </p>
              )}
              {it.replied_at ? (
                <p className="text-xs text-green-700 dark:text-green-400">
                  Replied {when(it.replied_at)}
                  {it.reply_by ? ` by ${it.reply_by}` : ''}
                  {it.reply_text ? `: ${it.reply_text}` : ''}
                </p>
              ) : canWrite && replying === it.id ? (
                <div className="space-y-2">
                  <textarea
                    rows={2}
                    className={inputCls}
                    value={text}
                    onChange={e => setText(e.target.value)}
                    placeholder="Write a reply"
                  />
                  <div className="flex gap-2 justify-end">
                    <button type="button" className={btnGhost} onClick={() => setReplying(null)}>
                      Cancel
                    </button>
                    <button
                      type="button"
                      className={btnPrimary}
                      disabled={sending || !text.trim()}
                      onClick={() => send(it.id)}
                    >
                      {sending ? 'Sending...' : 'Send reply'}
                    </button>
                  </div>
                </div>
              ) : (
                canWrite && (
                  <button
                    type="button"
                    className="control-sm border border-border-default text-accent-500 hover:bg-surface-secondary"
                    onClick={() => {
                      setReplying(it.id)
                      setText('')
                    }}
                  >
                    Reply
                  </button>
                )
              )}
            </li>
          ))}
        </ul>
      )}
    </Section>
  )
}
