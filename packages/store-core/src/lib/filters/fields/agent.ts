import { defineFields, type FilterOption } from '@jeffi/list-filters/client'

// Agent tool log filters: one row per assistant response that called tools; its proposed actions
// (admin_agent_actions) are matched through the response (client-safe; SQL in ../entities/agent.ts).

const opts = (pairs: [string, string][]): FilterOption[] => pairs.map(([value, label]) => ({ value, label }))
const YES_NO = opts([
  ['true', 'Yes'],
  ['false', 'No'],
])
const vh = (label: string, section: string) =>
  ({ label, type: 'value-help', section, placeholder: `Any ${label.toLowerCase()}`, noun: 'Responses' }) as const

export const AGENT_LOG_DEFAULT_DAYS = 30

export const AGENT_LOG_FIELDS = defineFields({
  has_error: { label: 'A tool call failed', type: 'toggle', options: YES_NO, quick: true, section: 'Tools' },
  tool: vh('Tool', 'Tools'),
  created: { name: ['from', 'to'], label: 'Date', type: 'date-range', section: 'Tools' },
  admin: vh('Member', 'Tools'),
  status: {
    label: 'Action status',
    type: 'multi-select',
    quick: true,
    section: 'Actions',
    options: opts([
      ['proposed', 'Awaiting approval'],
      ['approved', 'Approved'],
      ['executed', 'Executed'],
      ['failed', 'Failed'],
      ['rejected', 'Rejected'],
    ]),
  },
  kind: vh('Action', 'Actions'),
  has_action: { label: 'Proposed an action', type: 'toggle', options: YES_NO, section: 'Actions' },
})
