import { CardLoading, ConsoleLoading, LinesLoading } from '../_components/Skeleton'

export default function Loading() {
  return (
    <ConsoleLoading eyebrow="Store" title="Delivery" description="Delhivery shipments and tracking for your orders.">
      <CardLoading title="Delivery account">
        <LinesLoading lines={2} />
      </CardLoading>
    </ConsoleLoading>
  )
}
