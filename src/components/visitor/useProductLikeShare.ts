'use client'

import { useCallback, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/contexts/AuthContext'
import { useToast } from '@/contexts/ToastContext'
import { useWishlist } from '@/contexts/WishlistContext'

/** Wishlist toggle + share shared by the product card and its quick-add popup. */
export function useProductLikeShare({
  id,
  slug,
  name,
  href,
}: {
  id: string
  slug: string
  name: string
  href: string
}) {
  const { user } = useAuth()
  const { showToast, showConfirm } = useToast()
  const router = useRouter()
  const { has, toggle } = useWishlist()
  const [wishlistLoading, setWishlistLoading] = useState(false)
  const isInWishlist = has(id)

  const handleWishlist = useCallback(
    async (e: React.MouseEvent) => {
      e.preventDefault()
      e.stopPropagation()
      if (!user) {
        showConfirm({
          title: 'Sign In Required',
          message: 'Please sign in to save items to your wishlist.',
          confirmText: 'Sign In',
          cancelText: 'Maybe Later',
          type: 'info',
          onConfirm: () => router.push(`/login?redirect=/products/${slug}`),
        })
        return
      }
      setWishlistLoading(true)
      const result = await toggle(id)
      setWishlistLoading(false)
      if (result === 'added') showToast('Added to wishlist!', 'success')
      else if (result === 'removed') showToast('Removed from wishlist', 'success')
      else showToast('Failed to update wishlist', 'error')
    },
    [id, slug, user, toggle, router, showConfirm, showToast]
  )

  const handleShare = useCallback(
    async (e: React.MouseEvent) => {
      e.preventDefault()
      e.stopPropagation()
      const url = `${window.location.origin}${href}`
      const shareData = { title: name, text: `Check out ${name}`, url }
      if (navigator.share) {
        try {
          await navigator.share(shareData)
        } catch {}
      } else {
        await navigator.clipboard.writeText(url)
        showToast('Link copied to clipboard!', 'success')
      }
    },
    [href, name, showToast]
  )

  return { isInWishlist, wishlistLoading, handleWishlist, handleShare }
}
