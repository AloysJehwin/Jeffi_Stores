'use client'

import { useState, useEffect, useCallback } from 'react'
import { useToast } from '@/contexts/ToastContext'
import { useCanWrite } from '@/contexts/AdminScopesContext'
import AdminSelect from '@/components/admin/AdminSelect'
import AdminTypeahead from '@/components/admin/AdminTypeahead'
import AIEnrichButton from '@/components/admin/AIEnrichButton'
import DateTimePicker from '@/components/ui/DateTimePicker'
import Toggle from '@/components/ui/Toggle'
import { withProductLink } from '@/lib/social/product-url'

interface SelectedProduct {
  id: string
  name: string
  slug: string
  short_description: string | null
  description: string | null
  base_price: number | null
  stock_status: string | null
  product_images?: { image_url: string; thumbnail_url?: string; is_primary?: boolean }[]
}

interface SocialPost {
  id: string
  product_id: string | null
  platform: 'fb' | 'ig' | 'ig_reel'
  caption: string | null
  hashtags: string | null
  image_url: string | null
  video_url: string | null
  scheduled_at: string
  status: string
  posted_id: string | null
  last_error: string | null
  attempts: number
}

const PLATFORM_LABELS: Record<string, string> = {
  fb: 'Facebook',
  ig: 'Instagram',
  ig_reel: 'IG Reel',
}

const PLATFORM_COLORS: Record<string, string> = {
  fb: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
  ig: 'bg-pink-100 text-pink-700 dark:bg-pink-900/30 dark:text-pink-300',
  ig_reel: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300',
}

const STATUS_COLORS: Record<string, string> = {
  pending: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300',
  publishing: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300',
  posted: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300',
  failed: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300',
}

const inputCls =
  'w-full px-2 py-1.5 rounded-lg border border-border-default bg-surface-secondary text-foreground text-sm focus:outline-none focus:ring-1 focus:ring-secondary-500 dark:focus:ring-secondary-400'
const labelCls = 'block text-xs font-medium text-foreground-secondary mb-1'

function fmtDate(s: string) {
  if (!s) return ''
  const d = new Date(s)
  return d.toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export default function SocialPostsClient({ canWrite: canWriteProp = false }: { canWrite?: boolean }) {
  const { showToast } = useToast()
  const canWriteScope = useCanWrite('campaigns:write')
  const canWrite = canWriteProp && canWriteScope
  const [posts, setPosts] = useState<SocialPost[]>([])
  const [loading, setLoading] = useState(true)
  const [publishingId, setPublishingId] = useState<string | null>(null)
  const [showComposer, setShowComposer] = useState(false)

  const [platform, setPlatform] = useState<'fb' | 'ig' | 'ig_reel'>('fb')
  const [caption, setCaption] = useState('')
  const [productId, setProductId] = useState('')
  const [productName, setProductName] = useState('')
  const [selectedProduct, setSelectedProduct] = useState<SelectedProduct | null>(null)
  const [productLoading, setProductLoading] = useState(false)
  const [imageUrl, setImageUrl] = useState('')
  const [useAllImages, setUseAllImages] = useState(false)
  const [videoUrl, setVideoUrl] = useState('')
  const [scheduledAt, setScheduledAt] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [useAdCard, setUseAdCard] = useState(true)
  const [adCardUrl, setAdCardUrl] = useState('')
  const [adCardLoading, setAdCardLoading] = useState(false)
  const [rawPrimaryImage, setRawPrimaryImage] = useState('')

  useEffect(() => {
    if (!productId) {
      setSelectedProduct(null)
      return
    }
    let cancelled = false
    setProductLoading(true)
    fetch(`/api/admin/products/${productId}`, { credentials: 'include' })
      .then(r => (r.ok ? r.json() : null))
      .then(p => {
        if (cancelled || !p || p.error) return
        setSelectedProduct(p)
        const primaryImage = (p.product_images || []).find((i: any) => i.is_primary) || (p.product_images || [])[0]
        setRawPrimaryImage(primaryImage?.image_url || '')
        if (primaryImage?.image_url) setImageUrl(primaryImage.image_url)
        setCaption(c => withProductLink(c.trim() ? c : p.name, p.slug))
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setProductLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [productId])

  // The ad card is the same artwork the product list offers for download, rendered server-side
  // and stored in S3 so Meta can fetch it. Regenerated per product so price/discount are current.
  useEffect(() => {
    if (!productId || !useAdCard) return
    let cancelled = false
    setAdCardLoading(true)
    fetch(`/api/admin/products/${productId}/ad-image`, { method: 'POST', credentials: 'include' })
      .then(r => (r.ok ? r.json() : null))
      .then(d => {
        if (cancelled || !d?.url) return
        setAdCardUrl(d.url)
        setImageUrl(d.url)
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setAdCardLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [productId, useAdCard])

  function toggleAdCard(on: boolean) {
    setUseAdCard(on)
    if (!on) {
      setImageUrl(rawPrimaryImage)
    } else if (adCardUrl) {
      setImageUrl(adCardUrl)
    }
  }

  const fetchPosts = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/admin/social-posts', { credentials: 'include' })
      if (!res.ok) throw new Error('Failed')
      const data = await res.json()
      setPosts(data.posts || [])
    } catch {
      showToast('Failed to load social posts', 'error')
    } finally {
      setLoading(false)
    }
  }, [showToast])

  useEffect(() => {
    fetchPosts()
  }, [fetchPosts])

  function resetComposer() {
    setPlatform('fb')
    setCaption('')
    setProductId('')
    setProductName('')
    setImageUrl('')
    setUseAllImages(false)
    setVideoUrl('')
    setScheduledAt('')
    setUseAdCard(true)
    setAdCardUrl('')
    setRawPrimaryImage('')
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    try {
      // The ad card is the post: mixing raw photos in behind it would bury the card at slide 1
      // of a carousel, so extras are only sent when posting the raw images.
      const allProductImages = (selectedProduct?.product_images || []).map(i => i.image_url).filter(Boolean)
      const extraImages =
        !useAdCard && useAllImages && allProductImages.length >= 2
          ? allProductImages.filter(u => u !== imageUrl.trim())
          : null

      const res = await fetch('/api/admin/social-posts', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          platform,
          caption: caption.trim() || null,
          productId: productId.trim() || null,
          imageUrl: imageUrl.trim() || null,
          imageUrls: extraImages,
          videoUrl: videoUrl.trim() || null,
          scheduledAt: scheduledAt ? new Date(scheduledAt).toISOString() : null,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        showToast(data.error || 'Failed to queue post', 'error')
        return
      }
      showToast('Post queued', 'success')
      resetComposer()
      setShowComposer(false)
      fetchPosts()
    } catch {
      showToast('Failed to queue post', 'error')
    } finally {
      setSubmitting(false)
    }
  }

  async function postNow(post: SocialPost) {
    setPublishingId(post.id)
    try {
      const res = await fetch(`/api/admin/social-posts/${post.id}/publish`, { method: 'POST', credentials: 'include' })
      const data = await res.json()
      if (!res.ok || !data.ok) {
        showToast(data.error || 'Publish failed', 'error')
      } else {
        showToast('Posted', 'success')
      }
      fetchPosts()
    } catch {
      showToast('Publish failed', 'error')
    } finally {
      setPublishingId(null)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between mb-2">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-secondary-500 dark:text-foreground">Social Posts</h1>
          <p className="text-foreground-secondary mt-1 text-sm">Scheduled and posted Facebook / Instagram content</p>
        </div>
        {canWrite && (
          <button
            onClick={() => setShowComposer(v => !v)}
            className="flex items-center gap-2 px-4 py-2 bg-secondary-500 hover:bg-secondary-600 dark:bg-secondary-400 dark:hover:bg-secondary-300 dark:text-secondary-900 text-white rounded-lg text-sm font-semibold transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            New Post
          </button>
        )}
      </div>

      {canWrite && showComposer && (
        <form
          onSubmit={handleCreate}
          className="bg-surface-elevated border border-border-default rounded-xl p-4 space-y-3"
        >
          <h2 className="text-sm font-semibold text-foreground">New Post</h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className={labelCls}>Platform</label>
              <AdminSelect
                sm
                value={platform}
                onChange={v => setPlatform(v as 'fb' | 'ig' | 'ig_reel')}
                options={[
                  { value: 'fb', label: 'Facebook' },
                  { value: 'ig', label: 'Instagram' },
                  { value: 'ig_reel', label: 'Instagram Reel' },
                ]}
              />
            </div>
            <div>
              <label className={labelCls}>Product (optional)</label>
              <AdminTypeahead
                type="products"
                value={productName}
                onChange={v => {
                  setProductName(v)
                  if (!v) setProductId('')
                }}
                onSelect={item => {
                  setProductId(item.id)
                  setProductName(item.label)
                }}
                placeholder="Search by name or SKU…"
                inputClassName={inputCls + ' pr-9'}
              />
            </div>
            <div>
              <label className={labelCls}>Schedule (optional)</label>
              <DateTimePicker
                value={scheduledAt}
                onChange={setScheduledAt}
                className="w-full [&>button]:py-1.5"
                placeholder="Select date & time"
              />
            </div>
          </div>

          {productId && (productLoading || selectedProduct) && (
            <div className="flex items-center gap-3 p-2.5 rounded-lg border border-border-default bg-surface-secondary">
              {productLoading ? (
                <div className="text-xs text-foreground-muted">Loading product…</div>
              ) : (
                selectedProduct && (
                  <>
                    {(() => {
                      const img =
                        (selectedProduct.product_images || []).find(i => i.is_primary) ||
                        selectedProduct.product_images?.[0]
                      return img?.thumbnail_url || img?.image_url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={img.thumbnail_url || img.image_url}
                          alt=""
                          className="w-10 h-10 rounded-md object-cover border border-border-default shrink-0"
                        />
                      ) : null
                    })()}
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium text-foreground truncate">{selectedProduct.name}</div>
                      <div className="text-xs text-foreground-muted truncate">
                        {selectedProduct.base_price != null ? `₹${selectedProduct.base_price}` : ''}
                        {selectedProduct.stock_status ? ` · ${selectedProduct.stock_status}` : ''}
                      </div>
                    </div>
                    {platform !== 'ig_reel' && !useAdCard && (selectedProduct.product_images?.length ?? 0) >= 2 && (
                      <div className="shrink-0">
                        <Toggle
                          size="sm"
                          checked={useAllImages}
                          onChange={setUseAllImages}
                          label={`Use all ${selectedProduct.product_images!.length} images (carousel)`}
                        />
                      </div>
                    )}
                  </>
                )
              )}
            </div>
          )}

          {productId && platform !== 'ig_reel' && (
            <div className="flex items-start gap-3 p-2.5 rounded-lg border border-border-default bg-surface-secondary">
              {useAdCard && adCardUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={adCardUrl}
                  alt=""
                  className="w-10 h-[71px] rounded-md object-cover border border-border-default shrink-0"
                />
              )}
              <div className="min-w-0 flex-1">
                <Toggle checked={useAdCard} onChange={toggleAdCard} label="Post the ad card" />
                <p className="text-xs text-foreground-muted mt-0.5">
                  {adCardLoading
                    ? 'Generating ad card…'
                    : useAdCard
                      ? 'The same 1080×1920 card the product list generates, with price, discount badge and product link burnt in.'
                      : 'Posting the raw product photos instead.'}
                </p>
              </div>
            </div>
          )}

          <div>
            <label className={labelCls}>Caption (optional)</label>
            <AIEnrichButton
              fieldLabel="Social media caption"
              value={caption}
              onChange={setCaption}
              scope="campaigns:write"
              context={
                selectedProduct
                  ? `Product: ${selectedProduct.name}${selectedProduct.short_description ? ' — ' + selectedProduct.short_description : ''}. Platform: ${PLATFORM_LABELS[platform]}.`
                  : `Platform: ${PLATFORM_LABELS[platform]}.`
              }
              multiline
            >
              <textarea
                value={caption}
                onChange={e => setCaption(e.target.value)}
                rows={3}
                className={inputCls + ' resize-none pr-8'}
                placeholder="Leave blank to auto-generate from the product…"
              />
            </AIEnrichButton>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>
                Image URL {platform === 'ig' && <span className="text-red-500">*</span>}
              </label>
              <input
                type="text"
                value={imageUrl}
                onChange={e => setImageUrl(e.target.value)}
                className={inputCls}
                placeholder="https://…"
              />
            </div>
            <div>
              <label className={labelCls}>
                Video URL {platform === 'ig_reel' && <span className="text-red-500">*</span>}
              </label>
              <input
                type="text"
                value={videoUrl}
                onChange={e => setVideoUrl(e.target.value)}
                className={inputCls}
                placeholder="https://…"
              />
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button
              type="submit"
              disabled={submitting}
              className="px-6 py-2 bg-secondary-500 hover:bg-secondary-600 dark:bg-secondary-400 dark:hover:bg-secondary-300 dark:text-secondary-900 text-white rounded-lg text-sm font-semibold disabled:opacity-50 transition-colors"
            >
              {submitting ? 'Queuing…' : 'Queue Post'}
            </button>
            <button
              type="button"
              onClick={() => {
                resetComposer()
                setShowComposer(false)
              }}
              className="px-6 py-2 border border-border-default rounded-lg text-sm font-medium text-foreground hover:bg-surface-secondary transition-colors"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      <div className="bg-surface-elevated border border-border-default rounded-xl overflow-hidden">
        {loading ? (
          <div className="p-4 space-y-2">
            {[...Array(6)].map((_, i) => (
              <div
                key={i}
                className="flex items-center gap-3 px-2 py-1 animate-pulse"
                style={{ animationDelay: `${i * 50}ms` }}
              >
                <div className="h-4 w-20 bg-surface-secondary rounded" />
                <div className="h-4 flex-1 bg-surface-secondary rounded" />
                <div className="h-4 w-16 bg-surface-secondary rounded" />
                <div className="h-4 w-28 bg-surface-secondary rounded" />
                <div className="h-4 w-16 bg-surface-secondary rounded" />
              </div>
            ))}
          </div>
        ) : posts.length === 0 ? (
          <div className="p-12 text-center text-foreground-muted text-sm">No social posts yet.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border-default bg-surface-secondary">
                  <th className="px-4 py-3 text-left text-xs font-semibold text-foreground-secondary">Platform</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-foreground-secondary">Caption</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-foreground-secondary">Status</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-foreground-secondary">Scheduled</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-foreground-secondary">Posted ID</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-foreground-secondary">Actions</th>
                </tr>
              </thead>
              <tbody>
                {posts.map(post => (
                  <tr
                    key={post.id}
                    className="border-b border-border-default hover:bg-surface-secondary transition-colors"
                  >
                    <td className="px-4 py-3">
                      <span
                        className={`px-2 py-0.5 rounded-full text-xs font-medium ${PLATFORM_COLORS[post.platform] || ''}`}
                      >
                        {PLATFORM_LABELS[post.platform] || post.platform}
                      </span>
                    </td>
                    <td className="px-4 py-3 max-w-xs">
                      <div className="text-foreground truncate">
                        {post.caption || <span className="text-foreground-muted">—</span>}
                      </div>
                      {post.last_error && <div className="text-xs text-red-500 truncate mt-0.5">{post.last_error}</div>}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[post.status] || ''}`}
                      >
                        {post.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-foreground-secondary whitespace-nowrap text-xs">
                      {fmtDate(post.scheduled_at)}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-foreground-muted">{post.posted_id || '—'}</td>
                    <td className="px-4 py-3 text-right">
                      {canWrite && (post.status === 'pending' || post.status === 'failed') && (
                        <button
                          onClick={() => postNow(post)}
                          disabled={publishingId === post.id}
                          className="text-xs font-semibold text-secondary-600 dark:text-secondary-300 hover:text-secondary-800 dark:hover:text-secondary-100 disabled:opacity-50 transition-colors"
                        >
                          {publishingId === post.id ? 'Posting…' : 'Post now'}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
