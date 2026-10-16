'use client'

import { Tabs } from '@/components/admin/channels/ui'
import { OverviewPanel, useTab } from '../../orders/_components/overview-shared'

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'labels', label: 'Label generator' },
] as const
type View = (typeof TABS)[number]['id']

// The generator owns ?tab (product / batch / serial), so the page switch uses ?view.
export default function LabelsTabs({ generator }: { generator: React.ReactNode }) {
  const [view, setView] = useTab<View>(['overview', 'labels'], 'overview', {
    param: 'view',
    legacy: sp => (sp.get('tab') ? 'labels' : null),
  })
  return (
    <div className="space-y-5">
      <Tabs tabs={[...TABS]} value={view} onChange={setView} />
      {view === 'overview' ? <OverviewPanel endpoint="/api/admin/labels/overview" /> : generator}
    </div>
  )
}
