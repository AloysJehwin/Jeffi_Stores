import { CardLoading, ConsoleLoading, PillLoading, SkeletonRows } from '../_components/Skeleton'

export default function Loading() {
  return (
    <ConsoleLoading
      eyebrow="Account"
      title="Licences & certificates"
      description="What Indian law asks of the products you sell. We review each licence and email you before one expires."
      actions={<PillLoading />}
    >
      <div className="space-y-6">
        <CardLoading title="On file">
          <SkeletonRows rows={3} cols={3} />
        </CardLoading>
        <CardLoading title="Selling something new?" />
      </div>
    </ConsoleLoading>
  )
}
