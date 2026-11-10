import { CardLoading, ConsoleLoading, RowsLoading } from '../_components/Skeleton'
import { ConfiguratorLoading } from '../../_compute/ConfiguratorLoading'

export default function Loading() {
  return (
    <ConsoleLoading eyebrow="Store" title="Plan & servers" description="The plan your store runs on, its servers and database, and what they cost.">
      <div className="space-y-6">
        <CardLoading title="Running now">
          <RowsLoading labels={['Plan', 'Servers', 'Billing', 'Cost']} />
        </CardLoading>
        <CardLoading title="Change plan or servers">
          <ConfiguratorLoading />
        </CardLoading>
      </div>
    </ConsoleLoading>
  )
}
