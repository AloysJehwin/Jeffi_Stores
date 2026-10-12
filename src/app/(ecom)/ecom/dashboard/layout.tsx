import { Fraunces } from 'next/font/google'
import { loadOwnerContext } from '@/lib/ecom/owner-context'
import ConsoleShell from './ConsoleShell'

const display = Fraunces({
  subsets: ['latin'],
  weight: 'variable',
  axes: ['SOFT', 'opsz'],
  variable: '--font-display',
  display: 'swap',
})

export const dynamic = 'force-dynamic'

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { owner, tenants, tenant } = await loadOwnerContext()
  const lite = (t: typeof tenant) => ({ slug: t.slug, display_name: t.display_name, status: t.status })
  return (
    <div className={display.variable}>
      <ConsoleShell owner={{ email: owner.email, name: owner.name }} tenants={tenants.map(lite)} current={lite(tenant)}>
        {children}
      </ConsoleShell>
    </div>
  )
}
