import { AccountTransactionsVisitor } from '@/components/shared/AccountTransactions'
import { renderAccountFrame } from '@/components/visitor/site/code/parts/utility/site-page'

// The shopper's transactions, framed by the store's AI-designed account pages when it has them.
export default async function TransactionsPage({ searchParams }: { searchParams: Promise<{ preview?: string; layout?: string }> }) {
  return renderAccountFrame(await searchParams, <AccountTransactionsVisitor />)
}
