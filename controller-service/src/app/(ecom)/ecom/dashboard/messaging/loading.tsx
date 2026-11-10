import { CardLoading, ConsoleLoading, SandTableLoading, SegmentedLoading } from '../_components/Skeleton'
import { MESSAGE_COLUMNS } from './columns'

export default function Loading() {
  return (
    <ConsoleLoading
      eyebrow="Developers"
      title="Messaging"
      description="Templates, bulk sends and the delivery log for email, SMS and WhatsApp sent through your API keys."
      actions={<SegmentedLoading labels={['Message log', 'Templates', 'Bulk']} />}
    >
      <CardLoading>
        <SandTableLoading columns={MESSAGE_COLUMNS} rows={6} edge="-m-6" minWidth="min-w-[720px]" />
      </CardLoading>
    </ConsoleLoading>
  )
}
