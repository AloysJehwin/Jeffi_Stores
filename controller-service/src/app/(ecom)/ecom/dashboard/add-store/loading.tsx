import { CardLoading, ConsoleLoading } from '../_components/Skeleton'

export default function Loading() {
  return (
    <ConsoleLoading eyebrow="Store">
      <CardLoading />
    </ConsoleLoading>
  )
}
