import { cookies, headers } from 'next/headers'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { OWNER_COOKIE, resolveOwnerSession } from '@/lib/auth/owner-session'
import { getOwnerBankWithRoute } from '@/lib/tenant-registry'
import PayoutsClient, { type BankState } from './PayoutsClient'

export const dynamic = 'force-dynamic'

export default async function PayoutsPage() {
  const sid = (await cookies()).get(OWNER_COOKIE)?.value
  const h = await headers()
  const signals = {
    userAgent: h.get('user-agent'),
    acceptLanguage: h.get('accept-language'),
    uaPlatform: h.get('sec-ch-ua-platform'),
  }
  const owner = await resolveOwnerSession(sid, signals as any).catch(() => null)
  if (!owner) redirect('/signin')

  const bank = await getOwnerBankWithRoute(owner.id).catch(() => null)
  // Only the last four digits leave the server — the full number is never re-rendered.
  const initial: BankState | null =
    bank && bank.accountNumber
      ? {
          last4: bank.accountNumber.slice(-4),
          ifsc: bank.ifsc,
          holderName: bank.holderName,
          verifiedName: bank.verifiedName,
          verificationStatus: bank.verificationStatus,
          verificationRef: bank.verificationRef,
          hasRouteAccount: !!bank.linkedAccountId,
        }
      : null

  return (
    <div className="w-full px-6 lg:px-10 py-10">
      <div className="flex items-center gap-3 mb-8">
        <Link href="/dashboard" className="text-sm text-foreground-muted hover:text-foreground">
          ← Dashboard
        </Link>
      </div>
      <h1 className="text-2xl font-bold text-foreground mb-1">Payouts</h1>
      <p className="text-sm text-foreground-muted mb-8">
        Where your sales settle. Changes here are sent to the payment provider straight away.
      </p>
      <PayoutsClient initial={initial} />
    </div>
  )
}
