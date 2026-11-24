import type { Metadata } from 'next'
import Link from 'next/link'
import { cookies, headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { OWNER_COOKIE, resolveOwnerSession } from '@/lib/auth/owner-session'
import { CLAIM_ERRORS, peekClaim, redeemClaim, type ClaimPeek } from '@controller/lib/outreach/claim'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Claim your site', robots: { index: false, follow: false }, referrer: 'no-referrer' }

// The claim link sent with an outreach Showcase. Signed out: the site's name and a way into the email sign-in, which
// comes back here. Signed in: the site becomes the owner's and they go to it on the dashboard. The owner cookie is
// SameSite=strict, so arriving from a messaging app reads as signed out until the sign-in page sends them back.

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mx-auto flex min-h-[70vh] w-full max-w-md flex-col justify-center px-4 py-12">
      <h1 className="font-display text-3xl font-black text-foreground sm:text-4xl">{title}</h1>
      <div className="mt-4 space-y-5 text-foreground-secondary">{children}</div>
    </div>
  )
}

const signInHref = (token: string) => `/signin?next=${encodeURIComponent(`/claim/${token}`)}`
const button = 'ecom-accent-bg inline-flex w-full items-center justify-center rounded-full px-6 py-3 font-display font-bold text-white'

export default async function ClaimPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const h = await headers()
  const owner = await resolveOwnerSession((await cookies()).get(OWNER_COOKIE)?.value, {
    userAgent: h.get('user-agent'),
    acceptLanguage: h.get('accept-language'),
    uaPlatform: h.get('sec-ch-ua-platform'),
  }).catch(() => null)

  if (owner) {
    const r = await redeemClaim(token, owner.id).catch(() => null)
    if (r?.ok) redirect(`/dashboard/showcase/${r.siteId}`)
    return (
      <Card title="We couldn't claim this site">
        <p>{r ? r.error : 'Something went wrong. Please try again in a moment.'}</p>
        <Link href="/dashboard" className="inline-block font-semibold text-foreground underline underline-offset-2">
          Go to your dashboard
        </Link>
      </Card>
    )
  }

  const peek: ClaimPeek = await peekClaim(token).catch(() => ({ state: 'invalid' as const }))
  if (peek.state === 'valid')
    return (
      <Card title="Claim your site">
        <p>
          <span className="font-semibold text-foreground">{peek.siteName || 'Your site'}</span> is ready for you. Sign in, or create your
          account with your email, to make it yours: you can edit it, see its visitors and keep it online.
        </p>
        <Link href={signInHref(token)} className={button}>
          Sign in or create your account
        </Link>
      </Card>
    )
  if (peek.state === 'claimed')
    return (
      <Card title="This site has been claimed">
        <p>{CLAIM_ERRORS.used} If it is yours, sign in to see it on your dashboard.</p>
        <Link href={signInHref(token)} className={button}>
          Sign in
        </Link>
      </Card>
    )
  return (
    <Card title={peek.state === 'expired' ? 'This claim link has expired' : 'This claim link is not valid'}>
      <p>{peek.state === 'expired' ? CLAIM_ERRORS.expired : CLAIM_ERRORS.invalid}</p>
    </Card>
  )
}
