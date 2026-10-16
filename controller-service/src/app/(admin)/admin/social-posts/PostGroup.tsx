'use client'

import { useState } from 'react'
import { CalendarClock, ExternalLink, Pencil, RotateCcw, Send, X } from 'lucide-react'
import IconButton from '@/components/ui/IconButton'
import DateTimePicker from '@/components/ui/DateTimePicker'
import ImageUrlInput from '@/components/admin/ImageUrlInput'
import { useToast } from '@/contexts/ToastContext'
import { useCanWrite } from '@/contexts/AdminScopesContext'
import { Badge, api, btnGhost, btnPrimary, inputCls, when } from '@/components/admin/channels/ui'
import { APPROVAL_TONE, EDITABLE, STATUS_TONE, TITLE_PLATFORMS, fromLocalInput, label, metricsLine, toLocalInput, type Post } from './shared'

const BASE = '/api/admin/social-posts'

/** One compose (all its networks) with per-post actions. */
export default function PostGroup({ posts, onChange }: { posts: Post[]; onChange: () => void }) {
  const canWrite = useCanWrite('social')
  const { showToast } = useToast()
  const [busy, setBusy] = useState<string | null>(null)
  const [editing, setEditing] = useState<string | null>(null)
  const head = posts[0]
  const thumb = head.image_url

  async function act(id: string, kind: 'publish' | 'retry' | 'cancel' | 'schedule') {
    setBusy(`${kind}:${id}`)
    const r =
      kind === 'cancel'
        ? await api(`${BASE}/${id}`, { method: 'DELETE' })
        : kind === 'schedule'
          ? await api(`${BASE}/${id}`, { method: 'PATCH', json: { status: 'pending' } })
          : await api(`${BASE}/${id}/${kind}`, { method: 'POST' })
    setBusy(null)
    const failed = !r.ok || (kind === 'publish' && r.data.ok === false)
    if (failed) showToast(r.data.error || 'Failed', 'error')
    else showToast({ publish: 'Posted', retry: 'Queued again', cancel: 'Cancelled', schedule: 'Scheduled' }[kind], 'success')
    onChange()
  }

  return (
    <div className="rounded-lg border border-border-default p-3 space-y-2">
      <div className="flex items-start gap-3">
        {thumb && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={thumb} alt="" className="w-12 h-12 rounded-md object-cover border border-border-default shrink-0" />
        )}
        <div className="min-w-0 flex-1">
          {head.title && <p className="text-sm font-medium truncate">{head.title}</p>}
          <p className="text-sm text-foreground line-clamp-2 whitespace-pre-line">{head.caption || <span className="text-foreground-muted">Caption from the product</span>}</p>
          {head.hashtags && <p className="text-xs text-blue-600 dark:text-blue-400 truncate">{head.hashtags}</p>}
          <p className="text-xs text-foreground-muted mt-0.5">
            {when(head.scheduled_at)}
            {head.source && head.source !== 'manual' ? ` - ${head.source}` : ''}
          </p>
        </div>
      </div>
      <ul className="divide-y divide-border-default/60">
        {posts.map(p => {
          const metrics = metricsLine(p)
          return (
            <li key={p.id} className="py-2 space-y-1">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-medium w-36 shrink-0">{label(p.platform)}</span>
                <Badge tone={STATUS_TONE[p.status]}>{p.status}</Badge>
                {p.approval_status !== 'none' && <Badge tone={APPROVAL_TONE[p.approval_status]}>approval {p.approval_status}</Badge>}
                <div className="ml-auto flex items-center gap-0.5">
                  {p.permalink && (
                    <IconButton icon={ExternalLink} size="sm" label="View post" href={p.permalink} target="_blank" />
                  )}
                  {canWrite && EDITABLE.has(p.status) && (
                    <IconButton icon={Pencil} size="sm" label="Edit" onClick={() => setEditing(e => (e === p.id ? null : p.id))} />
                  )}
                  {canWrite && p.status === 'draft' && (
                    <IconButton icon={CalendarClock} size="sm" label="Schedule" busy={busy === `schedule:${p.id}`} onClick={() => act(p.id, 'schedule')} />
                  )}
                  {canWrite && (p.status === 'pending' || p.status === 'draft') && p.approval_status !== 'pending' && p.approval_status !== 'rejected' && (
                    <IconButton icon={Send} size="sm" label="Post now" busy={busy === `publish:${p.id}`} onClick={() => act(p.id, 'publish')} />
                  )}
                  {canWrite && (p.status === 'failed' || p.status === 'cancelled') && (
                    <IconButton icon={RotateCcw} size="sm" label="Retry" busy={busy === `retry:${p.id}`} onClick={() => act(p.id, 'retry')} />
                  )}
                  {canWrite && (p.status === 'draft' || p.status === 'pending' || p.status === 'failed') && (
                    <IconButton icon={X} size="sm" variant="danger" label="Cancel" busy={busy === `cancel:${p.id}`} onClick={() => act(p.id, 'cancel')} />
                  )}
                </div>
              </div>
              {metrics && <p className="text-xs text-foreground-muted tabular-nums">{metrics}</p>}
              {p.last_error && (p.status === 'failed' || (p.status === 'pending' && p.attempts > 0)) && (
                <p className="text-xs text-red-500">
                  {p.last_error}
                  {p.status === 'pending' && p.next_attempt_at ? ` - retry ${p.attempts + 1} at ${when(p.next_attempt_at)}` : ''}
                </p>
              )}
              {editing === p.id && (
                <EditPost
                  post={p}
                  onDone={saved => {
                    setEditing(null)
                    if (saved) onChange()
                  }}
                />
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}

function EditPost({ post, onDone }: { post: Post; onDone: (saved: boolean) => void }) {
  const canWrite = useCanWrite('social')
  const { showToast } = useToast()
  const [caption, setCaption] = useState(post.caption ?? '')
  const [hashtags, setHashtags] = useState(post.hashtags ?? '')
  const [title, setTitle] = useState(post.title ?? '')
  const [linkUrl, setLinkUrl] = useState(post.link_url ?? '')
  const [imageUrl, setImageUrl] = useState(post.image_url ?? '')
  const [videoUrl, setVideoUrl] = useState(post.video_url ?? '')
  const [at, setAt] = useState(toLocalInput(post.scheduled_at))
  const [saving, setSaving] = useState(false)

  async function save() {
    setSaving(true)
    const r = await api(`${BASE}/${post.id}`, {
      method: 'PATCH',
      json: {
        caption: caption.trim() || null,
        hashtags: hashtags.trim() || null,
        title: title.trim() || null,
        linkUrl: linkUrl.trim() || null,
        imageUrl: imageUrl.trim() || null,
        videoUrl: videoUrl.trim() || null,
        scheduledAt: fromLocalInput(at),
      },
    })
    setSaving(false)
    if (!r.ok) return showToast(r.data.error || 'Could not save', 'error')
    showToast('Saved', 'success')
    onDone(true)
  }

  if (!canWrite) return null
  const lbl = 'block text-xs font-medium text-foreground-secondary mb-1'
  return (
    <div className="mt-2 rounded-lg bg-surface-secondary p-3 space-y-2">
      <div>
        <label className={lbl}>Caption</label>
        <textarea rows={3} className={inputCls} value={caption} onChange={e => setCaption(e.target.value)} />
      </div>
      <div>
        <label className={lbl}>Hashtags</label>
        <input className={inputCls} value={hashtags} onChange={e => setHashtags(e.target.value)} />
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        {TITLE_PLATFORMS.includes(post.platform) && (
          <div>
            <label className={lbl}>Title</label>
            <input className={inputCls} value={title} onChange={e => setTitle(e.target.value)} />
          </div>
        )}
        <div>
          <label className={lbl}>Link</label>
          <input className={inputCls} value={linkUrl} onChange={e => setLinkUrl(e.target.value)} placeholder="Product page when blank" />
        </div>
        <div>
          <label className={lbl}>Image URL</label>
          <ImageUrlInput value={imageUrl} onChange={setImageUrl} className={inputCls} />
        </div>
        <div>
          <label className={lbl}>Video URL</label>
          <input className={inputCls} value={videoUrl} onChange={e => setVideoUrl(e.target.value)} />
        </div>
        <div>
          <label className={lbl}>Scheduled for</label>
          <DateTimePicker value={at} onChange={setAt} className="w-full" />
        </div>
      </div>
      <div className="flex gap-2 justify-end">
        <button type="button" className={btnGhost} onClick={() => onDone(false)}>
          Close
        </button>
        <button type="button" className={btnPrimary} disabled={saving} onClick={save}>
          {saving ? 'Saving...' : 'Save'}
        </button>
      </div>
    </div>
  )
}
