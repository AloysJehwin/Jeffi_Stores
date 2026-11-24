import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createElement, type ReactNode } from 'react'
import { render, screen } from '@testing-library/react'

// The ecom claim page: signed out, the site's name and a way into sign-in that comes back here; signed in, the
// claim and a redirect to the site; a clear note for a used, expired or bad link.

const h = vi.hoisted(() => ({
  cookie: { value: undefined as string | undefined },
  resolveOwnerSession: vi.fn(),
  peekClaim: vi.fn(),
  redeemClaim: vi.fn(),
  redirect: vi.fn((to: string) => {
    throw Object.assign(new Error('NEXT_REDIRECT'), { to })
  }),
}))
vi.mock('next/headers', () => ({
  cookies: async () => ({ get: () => (h.cookie.value ? { value: h.cookie.value } : undefined) }),
  headers: async () => new Headers({ 'user-agent': 'Safari' }),
}))
vi.mock('next/navigation', () => ({ redirect: h.redirect }))
vi.mock('next/link', () => ({ default: ({ href, children, ...rest }: { href: string; children?: ReactNode }) => createElement('a', { href, ...rest }, children) }))
vi.mock('@/lib/auth/owner-session', () => ({ OWNER_COOKIE: 'owner_sid', resolveOwnerSession: h.resolveOwnerSession }))
vi.mock('@controller/lib/outreach/claim', () => ({
  peekClaim: h.peekClaim,
  redeemClaim: h.redeemClaim,
  CLAIM_ERRORS: { invalid: 'Not valid.', expired: 'Expired.', used: 'Already used.', no_site: 'No site.' },
}))

import ClaimPage, { metadata } from '@controller/app/(ecom)/ecom/claim/[token]/page'

const TOKEN = 'mabc12.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'
const SITE = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
const page = async () => render(await ClaimPage({ params: Promise.resolve({ token: TOKEN }) }))

describe('ClaimPage', () => {
  beforeEach(() => {
    h.cookie.value = undefined
    h.resolveOwnerSession.mockResolvedValue(null)
    h.peekClaim.mockResolvedValue({ state: 'valid', siteName: 'Latte Cafe' })
  })

  it('signed out: names the site and signs in with a way back to the claim', async () => {
    await page()
    expect(screen.getByRole('heading', { name: 'Claim your site' })).toBeTruthy()
    expect(screen.getByText('Latte Cafe')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Sign in or create your account' }).getAttribute('href')).toBe(`/signin?next=${encodeURIComponent(`/claim/${TOKEN}`)}`)
    expect(h.redeemClaim).not.toHaveBeenCalled()
  })

  it('signed in: claims the site and goes to it', async () => {
    h.cookie.value = 'sid'
    h.resolveOwnerSession.mockResolvedValue({ id: 'owner-1' })
    h.redeemClaim.mockResolvedValue({ ok: true, siteId: SITE, tenantId: 't-1', already: false })
    await expect(page()).rejects.toMatchObject({ to: `/dashboard/showcase/${SITE}` })
    expect(h.resolveOwnerSession).toHaveBeenCalledWith('sid', expect.objectContaining({ userAgent: 'Safari' }))
    expect(h.redeemClaim).toHaveBeenCalledWith(TOKEN, 'owner-1')
  })

  it("signed in: says why it couldn't claim", async () => {
    h.resolveOwnerSession.mockResolvedValue({ id: 'owner-2' })
    h.redeemClaim.mockResolvedValue({ ok: false, code: 'used', error: 'Already used.' })
    await page()
    expect(screen.getByRole('heading', { name: "We couldn't claim this site" })).toBeTruthy()
    expect(screen.getByText('Already used.')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Go to your dashboard' }).getAttribute('href')).toBe('/dashboard')
    h.redeemClaim.mockRejectedValue(new Error('db down'))
    await page()
    expect(screen.getByText(/Something went wrong/)).toBeTruthy()
  })

  it.each([
    [{ state: 'claimed', siteName: 'Latte Cafe', claimedOwnerId: 'x' }, 'This site has been claimed'],
    [{ state: 'expired' }, 'This claim link has expired'],
    [{ state: 'invalid' }, 'This claim link is not valid'],
  ])('signed out: %o says "%s"', async (peek, heading) => {
    h.peekClaim.mockResolvedValue(peek)
    await page()
    expect(screen.getByRole('heading', { name: heading })).toBeTruthy()
  })

  it('treats a lookup failure as a bad link', async () => {
    h.peekClaim.mockRejectedValue(new Error('db down'))
    await page()
    expect(screen.getByRole('heading', { name: 'This claim link is not valid' })).toBeTruthy()
  })

  it('is never indexed and sends no referrer', () => {
    expect(metadata).toMatchObject({ robots: { index: false, follow: false }, referrer: 'no-referrer' })
  })
})
