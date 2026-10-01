import FinancialClient from './FinancialClient'

export const dynamic = 'force-dynamic'

export default function FinancialPage() {
  return (
    <div className="p-4 sm:p-6">
      <div className="mb-6">
        <h1 className="text-2xl sm:text-3xl font-bold text-secondary-500 dark:text-foreground">Financial</h1>
        <p className="text-foreground-secondary mt-1">Receivables, payables, P&amp;L and cashflow</p>
      </div>
      <FinancialClient />
    </div>
  )
}
