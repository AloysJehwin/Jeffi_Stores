'use client'

export default function DownloadAdButton({ productId, productName }: { productId: string; productName: string }) {
  const handleDownload = () => {
    const a = document.createElement('a')
    a.href = `/api/admin/products/${productId}/ad-image`
    a.download = `jeffi-ad-${productName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.png`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
  }

  return (
    <button
      onClick={handleDownload}
      title="Download WhatsApp Ad"
      className="text-purple-500 hover:text-purple-600 dark:text-purple-400 dark:hover:text-purple-300 transition-colors"
    >
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
      </svg>
    </button>
  )
}
