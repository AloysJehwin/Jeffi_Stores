import type { ReactNode } from 'react'
import { LoadingChart, LoadingKpis, LoadingLines, LoadingSection, LoadingTable } from '@/components/admin/kit/skeleton'
import { SplitRow } from '@/components/admin/kit'

// Each finance tab's body while its data loads: real KPI labels, chart and section titles.

function ChartRow({ chart, donut }: { chart: string; donut: string }) {
  return (
    <SplitRow
      at="xl"
      wide={
        <LoadingChart title={chart} />
      }
      narrow={
        <LoadingSection title={donut} lines={4} />
      }
    />
  )
}

function TableSection({ title, columns, rows = 5 }: { title: string; columns: string[]; rows?: number }) {
  return (
    <LoadingSection title={title}>
      <LoadingTable bare rows={rows} columns={columns} />
    </LoadingSection>
  )
}

function Body({ children }: { children: ReactNode }) {
  return <div className="space-y-5">{children}</div>
}

export function OverviewTabSkeleton() {
  return (
    <Body>
      <LoadingKpis labels={['Net sales', 'Gross margin', 'Inflow', 'Outflow', 'Net cash', 'Refunds issued', 'Receivables', 'Payables due in 7 days', 'COD awaiting remittance']} />
      <LoadingSection title="Needs attention" lines={4} />
      <ChartRow chart="Cash flow" donut="Outflow composition" />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <LoadingSection title="Receivables aging" lines={4} />
        <LoadingSection title="Payables aging" lines={4} />
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        <LoadingSection title="Sales by payment method" lines={4} />
        <LoadingSection title="Sales by channel" lines={4} />
        <LoadingChart title="Revenue vs expenses" height="h-40" />
      </div>
    </Body>
  )
}

export function ReceivablesTabSkeleton() {
  return (
    <Body>
      <LoadingKpis labels={['Outstanding', 'Overdue (60+ days)', 'Avg days outstanding', 'Invoices']} />
      <ChartRow chart="Outstanding by aging" donut="Aging" />
      <TableSection title="Top debtors" columns={['Customer', 'Invoices', 'Oldest', 'Outstanding']} />
      <TableSection title="Overdue invoices" columns={['Invoice', 'Customer', 'Date', 'Days', 'Amount']} />
    </Body>
  )
}

export function PayablesTabSkeleton() {
  return (
    <Body>
      <LoadingKpis labels={['Outstanding', 'Overdue', 'Due this week', 'Paid in period', 'Open bills']} />
      <ChartRow chart="Outflow by method" donut="Aging" />
      <TableSection title="Open bills" columns={['Bill', 'Due', 'Amount', 'Paid', 'Due now', 'Status']} />
      <TableSection title="Top suppliers by outstanding" columns={['Supplier', 'Open bills', 'Overdue', 'Outstanding']} />
    </Body>
  )
}

export function TransactionsTabSkeleton() {
  return (
    <Body>
      <LoadingKpis labels={['Inflow', 'Outflow', 'Net', 'Transactions']} />
      <ChartRow chart="Inflow vs outflow" donut="By method" />
      <TableSection title="By method" columns={['Method', 'Inflow', 'Outflow', 'Net', 'Txns']} />
      <TableSection title="Top counterparties" columns={['Counterparty', 'Kind', 'Inflow', 'Outflow', 'Txns']} />
    </Body>
  )
}

export function PLTabSkeleton() {
  return (
    <Body>
      <LoadingKpis labels={['Revenue', 'Net revenue', 'COGS', 'Gross profit', 'Op expenses', 'Op profit', 'GST collected', 'Orders']} />
      <ChartRow chart="Revenue, COGS and gross profit" donut="Revenue by source" />
      <TableSection title="Monthly P&L" columns={['Month', 'Revenue', 'Refunds', 'Net rev', 'COGS', 'Gross profit', 'Margin', 'Op exp', 'Op profit', 'Orders']} />
    </Body>
  )
}

export function CashflowTabSkeleton() {
  return (
    <Body>
      <LoadingKpis labels={['Cash in', 'Cash out', 'Net', 'Opening balance', 'Closing balance']} />
      <ChartRow chart="Cash flow" donut="Cash in by source" />
      <TableSection title="Monthly cashflow" columns={['Month', 'Cash in', 'Supplier', 'Refunds', 'Cash out', 'Net', 'Balance']} />
    </Body>
  )
}

export function CodRemittanceTabSkeleton() {
  return (
    <Body>
      <LoadingKpis labels={['Collected', 'Pending', 'Remitted']} />
      <ChartRow chart="Weekly collection" donut="By status" />
      <TableSection title="Orders" columns={['Order', 'Customer', 'Amount', 'Status', 'Delivered', 'Remitted']} />
    </Body>
  )
}

export function MessagingTabSkeleton() {
  return (
    <Body>
      <LoadingKpis labels={['Total spend', 'SMS', 'WhatsApp', 'Email', 'Sends', 'Failed']} />
      <ChartRow chart="Spend by channel" donut="By channel" />
      <TableSection title="By direction" rows={3} columns={['Direction', 'Sends', 'Spent']} />
      <TableSection title="By template" columns={['Template', 'Channel', 'Sends', 'Spent']} />
      <TableSection title="By campaign" columns={['Campaign', 'Channel', 'Sends', 'Spent']} />
      <TableSection title="Top recipients" columns={['Recipient', 'Channel', 'Sends', 'Spent']} />
    </Body>
  )
}

export function AiCostsTabSkeleton() {
  return (
    <Body>
      <LoadingKpis labels={['Calls', 'Platform cost', 'Failed']} />
      <ChartRow chart="By provider" donut="By capability" />
      <TableSection title="By feature" columns={['Feature', 'Calls', 'Platform cost', 'Failed']} />
      <TableSection title="By provider" rows={3} columns={['Provider', 'Calls', 'Platform cost', 'Failed']} />
    </Body>
  )
}

export function DisputesTabSkeleton() {
  return (
    <Body>
      <LoadingKpis labels={['Open', 'Due in 3 days', 'Lost', 'Won']} />
      <TableSection title="Chargebacks" columns={['Order', 'Amount', 'Reason', 'Status', 'Respond by', 'Opened']} />
    </Body>
  )
}

export function RazorpaySettlementsTabSkeleton() {
  return (
    <Body>
      <LoadingKpis labels={['Settled to bank', 'Razorpay fees + GST', 'Awaiting settlement']} />
      <TableSection title="Settlements" columns={['Settled', 'Settlement', 'UTR', 'To bank', 'Fees + GST', 'Lines']} />
      <TableSection title="Awaiting settlement" columns={['Order', 'Payment', 'Amount', 'Paid', 'Expected by']} />
    </Body>
  )
}

export function RoutePayoutsTabSkeleton() {
  return (
    <Body>
      <LoadingKpis labels={['Online sales', 'Platform commission', 'Gateway fees', 'Your share', 'Paid to your bank', 'Not paid out yet']} />
      <TableSection title="Payouts to your bank" columns={['Paid out', 'Payout', 'UTR', 'To bank', 'Fees + GST', 'Payments']} />
      <TableSection title="Not paid out yet" columns={['Paid', 'Order', 'Payment', 'Your share', 'Status']} />
    </Body>
  )
}

export function MarketplaceSettlementsTabSkeleton() {
  return (
    <Body>
      <LoadingKpis labels={['Settled to bank', 'Commission + fees', 'Receivable', 'Overdue']} />
      <TableSection title="By marketplace" rows={3} columns={['Marketplace', 'Payouts', 'Sales', 'Commission + fees', 'TCS / TDS', 'Refunds', 'Settled', 'Receivable', 'Last settled']} />
      <TableSection title="Payouts" columns={['Settled', 'Marketplace', 'Reference', 'Sales', 'Charges']} />
    </Body>
  )
}

/** A settlement's lines while they load. */
export function SettlementLinesSkeleton() {
  return (
    <div className="space-y-3">
      <LoadingLines lines={1} />
      <LoadingTable bare rows={3} columns={['Type', 'Razorpay id', 'Amount', 'Fee + GST', 'Net', 'Paid']} />
    </div>
  )
}
