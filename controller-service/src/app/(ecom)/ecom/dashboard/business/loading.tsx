import { CardLoading, ConsoleLoading, FieldLoading, LinesLoading } from '../_components/Skeleton'

export default function Loading() {
  return (
    <ConsoleLoading
      eyebrow="Account"
      title="Business verification"
      description="Jeffi verifies the business behind each service before switching it on. Save each part as you go; documents are checked as soon as you upload them."
    >
      <div className="space-y-6">
        <CardLoading title="Where your services stand">
          <LinesLoading lines={2} />
        </CardLoading>
        <CardLoading title="Business details">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {['Legal name', 'Trade name', 'Business type', 'Mobile'].map(l => (
              <FieldLoading key={l} label={l} />
            ))}
            <FieldLoading label="Address" className="sm:col-span-2" />
          </div>
        </CardLoading>
        <CardLoading title="PAN">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <FieldLoading label="PAN" />
          </div>
        </CardLoading>
        <CardLoading title="GST registration" />
      </div>
    </ConsoleLoading>
  )
}
