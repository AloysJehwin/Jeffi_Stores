import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react'
import CookieConsentBanner, { CookieSettingsLink } from '@/components/visitor/CookieConsentBanner'
import { CONSENT_COOKIE } from '@/lib/analytics/google-tag'
import { readConsent } from '@/lib/client/consent'

type W = { gtag?: unknown; jeffiConsent?: boolean }

beforeEach(() => {
  document.cookie = `${CONSENT_COOKIE}=; Max-Age=0; Path=/`
  ;(window as unknown as W).gtag = vi.fn()
})
afterEach(() => {
  cleanup()
  delete (window as unknown as W).jeffiConsent
})

describe('CookieConsentBanner', () => {
  it('asks until the visitor chooses; reject stores analytics and ads off', () => {
    render(<CookieConsentBanner />)
    fireEvent.click(screen.getByRole('button', { name: 'Reject non-essential' }))
    expect(readConsent()).toEqual({ analytics: false, ads: false })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect((window as unknown as { gtag: ReturnType<typeof vi.fn> }).gtag).toHaveBeenCalledWith(
      'consent',
      'update',
      expect.objectContaining({ ad_storage: 'denied', analytics_storage: 'denied' })
    )
  })

  it('accept all grants both', () => {
    render(<CookieConsentBanner />)
    fireEvent.click(screen.getByRole('button', { name: 'Accept all' }))
    expect(readConsent()).toEqual({ analytics: true, ads: true })
  })

  it('customise lets analytics be granted without ads', () => {
    render(<CookieConsentBanner />)
    fireEvent.click(screen.getByRole('button', { name: 'Customise' }))
    fireEvent.click(document.getElementById('consent-analytics')!)
    fireEvent.click(screen.getByRole('button', { name: 'Save choices' }))
    expect(readConsent()).toEqual({ analytics: true, ads: false })
  })

  it('stays hidden once chosen and reopens from Cookie settings', () => {
    document.cookie = `${CONSENT_COOKIE}=v1.0.1; Path=/`
    ;(window as unknown as W).jeffiConsent = true
    render(
      <>
        <CookieConsentBanner />
        <CookieSettingsLink />
      </>
    )
    expect(screen.queryByRole('dialog')).toBeNull()
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Cookie settings' }))
    })
    expect(screen.getByRole('dialog')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Save choices' })).toBeTruthy()
  })

  it('Cookie settings link is absent on stores without consent mode', () => {
    render(<CookieSettingsLink />)
    expect(screen.queryByRole('button', { name: 'Cookie settings' })).toBeNull()
  })
})
