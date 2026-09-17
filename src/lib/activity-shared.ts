export type ActivityCategory = 'auth' | 'orders' | 'support' | 'account' | 'admin' | 'marketing' | 'other'

export function categoryFor(kind: string): ActivityCategory {
  if (kind === 'login' || kind === 'logout' || kind === 'signup' || kind === 'password_changed') return 'auth'
  if (kind === 'order_placed' || kind === 'order_status' || kind === 'payment_status' || kind === 'return_requested' || kind === 'return_status' || kind === 'address_change' || kind === 'cart_abandoned' || kind === 'cart_item_added' || kind === 'cart_item_removed' || kind === 'product_viewed') return 'orders'
  if (kind === 'support_message' || kind === 'support_session_started') return 'support'
  if (kind === 'address_added' || kind === 'address_updated' || kind === 'address_removed' || kind === 'profile_updated' || kind === 'wishlist_added' || kind === 'wishlist_removed' || kind === 'review_submitted') return 'account'
  if (kind === 'tag_added' || kind === 'tag_removed' || kind === 'note_added' || kind === 'flagged' || kind === 'unflagged' || kind === 'task_created' || kind === 'task_completed') return 'admin'
  if (kind === 'marketing_opted_in' || kind === 'marketing_opted_out') return 'marketing'
  return 'other'
}
