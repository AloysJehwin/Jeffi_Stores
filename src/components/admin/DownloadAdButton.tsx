'use client'

import { useState } from 'react'

export default function DownloadAdButton({ productId, productName, productSlug }: { productId: string; productName: string; productSlug?: string }) {
  const [sharing, setSharing] = useState(false)

  const handleDownload = () => {
    const a = document.createElement('a')
    a.href = `/api/admin/products/${productId}/ad-image`
    a.download = `jeffi-ad-${productName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.png`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
  }

  const handleShare = async () => {
    setSharing(true)
    try {
      const productUrl = `https://jeffistores.in/products/${productSlug || ''}`
      const message = `*${productName}*\n\nShop now 👉 ${productUrl}`

      const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent)

      if (isMobile && navigator.canShare) {
        const res = await fetch(`/api/admin/products/${productId}/ad-image`)
        const blob = await res.blob()
        const file = new File([blob], `jeffi-ad-${productName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.png`, { type: 'image/png' })
        if (navigator.canShare({ files: [file] })) {
          await navigator.share({ files: [file], text: message })
          return
        }
      }

      const a = document.createElement('a')
      a.href = `/api/admin/products/${productId}/ad-image`
      a.download = `jeffi-ad-${productName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.png`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)

      setTimeout(() => {
        window.open(`https://wa.me/?text=${encodeURIComponent(message)}`, '_blank')
      }, 800)
    } catch {
    } finally {
      setSharing(false)
    }
  }

  return (
    <div className="flex items-center gap-1.5">
      <button
        onClick={handleDownload}
        title="Download WhatsApp Ad"
        className="text-purple-500 hover:text-purple-600 dark:text-purple-400 dark:hover:text-purple-300 transition-colors"
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
        </svg>
      </button>
      <button
        onClick={handleShare}
        disabled={sharing}
        title="Share via WhatsApp"
        className="text-green-600 hover:text-green-700 dark:text-green-500 dark:hover:text-green-400 transition-colors disabled:opacity-40"
      >
        {sharing
          ? (
            <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          )
          : (
            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
              <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
            </svg>
          )
        }
      </button>
    </div>
  )
}
