import { CardLoading, ConsoleLoading, PillLoading, RowsLoading } from '../_components/Skeleton'

export default function Loading() {
  return (
    <ConsoleLoading
      eyebrow="Account"
      title="Business details"
      description="What you submitted during onboarding. Contact support to change any of it."
      actions={<PillLoading />}
    >
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <CardLoading title="Business">
          <RowsLoading labels={['Legal name', 'Type', 'Address', 'Mobile', 'Categories']} />
        </CardLoading>
        <CardLoading title="Tax">
          <RowsLoading labels={['GSTIN', 'PAN', 'GST certificate', 'Legals accepted']} />
        </CardLoading>
      </div>
    </ConsoleLoading>
  )
}
