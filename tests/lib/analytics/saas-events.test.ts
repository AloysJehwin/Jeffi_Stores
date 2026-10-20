import { describe, it, expect, beforeEach, vi } from 'vitest'
import { trackSaasEvent } from '@/lib/client/analytics'

type W = Window & { gtag?: (...args: unknown[]) => void }

describe('trackSaasEvent', () => {
  beforeEach(() => {
    localStorage.clear()
    delete (window as W).gtag
  })

  it('is a no-op without a loaded Google tag', () => {
    expect(trackSaasEvent('sign_up', { method: 'otp' })).toBe(false)
  })

  it('sends the event with its params', () => {
    const gtag = vi.fn()
    ;(window as W).gtag = gtag
    expect(trackSaasEvent('sign_up', { method: 'google' })).toBe(true)
    expect(gtag).toHaveBeenCalledWith('event', 'sign_up', { method: 'google' })
  })

  it('fires once per onceKey across reloads, independently of the purchase dedupe list', () => {
    const gtag = vi.fn()
    ;(window as W).gtag = gtag
    const params = { transaction_id: 'sub_1', value: 4999, currency: 'INR' }
    expect(trackSaasEvent('saas_subscription_paid', params, 'sub:sub_1')).toBe(true)
    expect(trackSaasEvent('saas_subscription_paid', params, 'sub:sub_1')).toBe(false)
    expect(trackSaasEvent('saas_subscription_paid', { ...params, transaction_id: 'sub_2' }, 'sub:sub_2')).toBe(true)
    expect(gtag).toHaveBeenCalledTimes(2)
    expect(localStorage.getItem('jeffi_saas_tracked')).toBe(JSON.stringify(['sub:sub_1', 'sub:sub_2']))
    expect(localStorage.getItem('jeffi_ga_purchased')).toBeNull()
  })
})
