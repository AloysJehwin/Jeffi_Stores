import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useRouter } from 'expo-router'
import { addToWishlist, getWishlist, removeFromWishlist } from '../api/wishlist'
import { useAuthStore } from '../stores/authStore'
import { showToast } from '../stores/toastStore'

/** Membership + toggle for one product, sharing the ['wishlist'] query with the Wishlist tab. */
export function useWishlistToggle(productId: string) {
  const router = useRouter()
  const qc = useQueryClient()
  const user = useAuthStore(s => s.user)
  const { data } = useQuery({ queryKey: ['wishlist'], queryFn: getWishlist, enabled: !!user, staleTime: 60_000 })
  const inWishlist = !!data?.some(i => i.product_id === productId)

  const mutation = useMutation({
    mutationFn: () => (inWishlist ? removeFromWishlist(productId) : addToWishlist(productId)),
    onSuccess: () => {
      showToast(inWishlist ? 'Removed from wishlist' : 'Added to wishlist', 'success')
      qc.invalidateQueries({ queryKey: ['wishlist'] })
    },
    onError: (e: Error) => showToast(e.message || 'Could not update wishlist', 'error'),
  })

  const toggle = () => {
    if (!user) return router.push('/(auth)/login')
    if (!mutation.isPending) mutation.mutate()
  }
  return { inWishlist, toggle, pending: mutation.isPending }
}
