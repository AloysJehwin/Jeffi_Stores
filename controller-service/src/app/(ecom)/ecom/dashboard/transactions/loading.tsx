import { ConsoleLoading, FinanceTableLoading } from '../_components/Skeleton'

export default function Loading() {
  return (
    <ConsoleLoading eyebrow="Finance" title="Transactions" description="Every captured order, with your share and platform fees.">
      <FinanceTableLoading columns={['Order ref', 'Date', 'Gross', 'Your share', 'Commission', 'Gateway fee', 'Method', 'Status', 'Paid out']} />
    </ConsoleLoading>
  )
}
