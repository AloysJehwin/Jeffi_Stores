import { describe, it, expect } from 'vitest'
import { categoryFor } from '@/lib/activity-shared'

describe('categoryFor', () => {
  it('returns auth for login', () => expect(categoryFor('login')).toBe('auth'))
  it('returns auth for logout', () => expect(categoryFor('logout')).toBe('auth'))
  it('returns auth for signup', () => expect(categoryFor('signup')).toBe('auth'))
  it('returns auth for password_changed', () => expect(categoryFor('password_changed')).toBe('auth'))

  it('returns orders for order_placed', () => expect(categoryFor('order_placed')).toBe('orders'))
  it('returns orders for order_status', () => expect(categoryFor('order_status')).toBe('orders'))
  it('returns orders for payment_status', () => expect(categoryFor('payment_status')).toBe('orders'))
  it('returns orders for return_requested', () => expect(categoryFor('return_requested')).toBe('orders'))
  it('returns orders for cart_item_added', () => expect(categoryFor('cart_item_added')).toBe('orders'))
  it('returns orders for product_viewed', () => expect(categoryFor('product_viewed')).toBe('orders'))

  it('returns support for support_message', () => expect(categoryFor('support_message')).toBe('support'))
  it('returns support for support_session_started', () => expect(categoryFor('support_session_started')).toBe('support'))

  it('returns account for address_added', () => expect(categoryFor('address_added')).toBe('account'))
  it('returns account for profile_updated', () => expect(categoryFor('profile_updated')).toBe('account'))
  it('returns account for wishlist_added', () => expect(categoryFor('wishlist_added')).toBe('account'))
  it('returns account for review_submitted', () => expect(categoryFor('review_submitted')).toBe('account'))

  it('returns admin for tag_added', () => expect(categoryFor('tag_added')).toBe('admin'))
  it('returns admin for note_added', () => expect(categoryFor('note_added')).toBe('admin'))
  it('returns admin for task_created', () => expect(categoryFor('task_created')).toBe('admin'))
  it('returns admin for task_completed', () => expect(categoryFor('task_completed')).toBe('admin'))
  it('returns admin for flagged', () => expect(categoryFor('flagged')).toBe('admin'))

  it('returns marketing for marketing_opted_in', () => expect(categoryFor('marketing_opted_in')).toBe('marketing'))
  it('returns marketing for marketing_opted_out', () => expect(categoryFor('marketing_opted_out')).toBe('marketing'))

  it('returns other for unknown kind', () => expect(categoryFor('some_random_event')).toBe('other'))
  it('returns other for empty string', () => expect(categoryFor('')).toBe('other'))
})
