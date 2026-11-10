import { FileText, Layers, Palette } from 'lucide-react'
import { CardLoading, ConsoleLoading, SandTableLoading, SegmentedLoading } from '../_components/Skeleton'
import { DOCUMENT_COLUMNS } from './columns'

export default function Loading() {
  return (
    <ConsoleLoading
      eyebrow="Developers"
      title="Documents"
      description="Every PDF rendered through your API keys, and the design they use."
      actions={<SegmentedLoading labels={['Documents', 'Designs', 'Bulk']} icons={[FileText, Palette, Layers]} />}
    >
      <CardLoading>
        <SandTableLoading columns={DOCUMENT_COLUMNS} edge="-m-6" minWidth="min-w-[720px]" />
      </CardLoading>
    </ConsoleLoading>
  )
}
