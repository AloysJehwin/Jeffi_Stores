import { TabLinks } from '@/components/admin/channels/ui'

type SP = { [k: string]: string | string[] | undefined }

// Overview is the default tab. A ?tab=list link, or any list filter from an old URL, opens the list.
const LIST_PARAMS = ['status', 'plan', 'q']

export function ecomTab(sp: SP): 'overview' | 'list' {
  if (sp.tab === 'list') return 'list'
  if (sp.tab === 'overview') return 'overview'
  return LIST_PARAMS.some(k => sp[k]) ? 'list' : 'overview'
}

export default function EcomTabs({
  base,
  active,
  listLabel,
  actions,
}: {
  base: string
  active: 'overview' | 'list'
  listLabel: string
  actions?: React.ReactNode
}) {
  const tabs = [
    { id: 'overview' as const, label: 'Overview', href: base },
    { id: 'list' as const, label: listLabel, href: `${base}?tab=list` },
  ]
  return (
    <TabLinks tabs={tabs} value={active} actions={actions} />
  )
}
