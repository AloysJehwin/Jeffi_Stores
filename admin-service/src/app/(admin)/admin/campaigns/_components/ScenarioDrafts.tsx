'use client'

import { Sparkles } from 'lucide-react'
import { ap } from '@/lib/shared/admin-path'
import WizardDrafts from '@/components/admin/drafts/WizardDrafts'

const STEP_LABEL: Record<string, string> = { describe: 'describing', review_sql: 'reviewing SQL', dry_run: 'dry run', save: 'naming' }

/** New-scenario wizards left part-way. */
export default function ScenarioDrafts() {
  return (
    <WizardDrafts
      endpoint="/api/admin/campaigns/scenarios/drafts"
      heading="Scenarios in progress"
      icon={<Sparkles className="h-4 w-4" />}
      writeScope="campaigns"
      label={d => d.title || (d.name as string | null) || 'Untitled scenario'}
      detail={d => (d.step ? (STEP_LABEL[d.step as string] ?? (d.step as string)) : null)}
      resumeHref={id => ap(`/admin/campaigns/scenarios/new?draft=${id}`)}
      discardMessage="The generated SQL and dry run are lost."
    />
  )
}
