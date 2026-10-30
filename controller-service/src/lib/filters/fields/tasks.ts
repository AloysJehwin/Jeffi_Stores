import { defineFields, type FilterAlias, type FilterOption } from '@jeffi/list-filters/client'

// Tasks list filters (client-safe; the SQL is in ../entities/tasks.ts).

const opts = (pairs: [string, string][]): FilterOption[] => pairs.map(([value, label]) => ({ value, label }))

/** source_kind values per segment (auto-created tasks); manual tasks are their own segment. */
export const TASK_KIND_SEGMENTS: Record<string, string[]> = {
  orders: [
    'process_confirmed',
    'stuck_processing',
    'stuck_shipment',
    'ndr_check',
    'address_rto',
    'chase_refund',
    'review_return',
    'schedule_pickup',
    'inspect_refund',
    'process_refund',
    'confirm_cod_payment',
    'review_high_value_order',
    'review_flagged',
    'contact_failed_payment',
    'retry_failed_refund',
    'abandoned_checkout',
  ],
  support: ['support_pickup', 'support_urgent'],
  customers: [
    'b2b_welcome',
    'collect_gst',
    'vip_check_in',
    'winback',
    'lead_followup',
    'save_customer',
    'respond_review',
    'followup_quote',
    'chase_quote_payment',
  ],
  security: ['login_anomaly'],
}

export const TASK_FIELDS = defineFields({
  scope: {
    label: 'Tasks',
    type: 'select',
    quick: true,
    options: opts([
      ['mine', 'My tasks'],
      ['unassigned', 'Unassigned'],
    ]),
    section: 'Status',
  },
  // Open / overdue / recently completed, as the list's tabs had it.
  status: {
    label: 'Status',
    type: 'select',
    quick: true,
    options: opts([
      ['open', 'Open'],
      ['overdue', 'Overdue'],
      ['completed', 'Completed (30 days)'],
    ]),
    section: 'Status',
  },
  segment: {
    label: 'Type',
    type: 'multi-select',
    quick: true,
    options: opts([
      ['orders', 'Orders'],
      ['support', 'Support'],
      ['customers', 'Customers'],
      ['security', 'Security'],
      ['manual', 'Manual'],
    ]),
    section: 'Status',
  },
  priority: {
    label: 'Priority',
    type: 'multi-select',
    quick: true,
    options: opts([
      ['urgent', 'Urgent'],
      ['high', 'High'],
      ['medium', 'Medium'],
      ['low', 'Low'],
    ]),
    section: 'Status',
  },
  task_status: {
    label: 'Task state',
    type: 'multi-select',
    options: opts([
      ['pending', 'Pending'],
      ['in_progress', 'In progress'],
      ['completed', 'Completed'],
      ['cancelled', 'Cancelled'],
    ]),
    section: 'Status',
  },
  assigned: { label: 'Assigned to', type: 'value-help', placeholder: 'Anyone', noun: 'Tasks', section: 'Owner' },
  source: { label: 'Created by rule', type: 'value-help', placeholder: 'Any rule', noun: 'Tasks', section: 'Owner' },
  auto_created: {
    label: 'Created',
    type: 'toggle',
    options: opts([
      ['true', 'Automatically'],
      ['false', 'By hand'],
    ]),
    section: 'Owner',
  },
  due: { label: 'Due', type: 'date-range', section: 'Dates' },
  no_due: { label: 'No due date', type: 'boolean', section: 'Dates' },
  created: { name: ['from', 'to'], label: 'Created on', type: 'date-range', section: 'Dates' },
})

export const TASK_ALIASES: FilterAlias[] = []

export const TASK_SEARCH = { placeholder: 'Search tasks or customers…', param: 'search' }

/** The list tab opens on my open tasks; links without a choice show every task. */
export const TASK_LIST_PRESET = 'scope=mine&status=open'
