'use client'

import BatchSerialLabelPicker from '@/components/admin/BatchSerialLabelPicker'
import { LABEL_SIZES, type LabelSpec } from '@/lib/label-sizes'

// Inline (Labels page tab) wrapper around the shared batch/serial label picker.
// The same picker is reused inside BatchSerialLabelModal for the PO-receive and
// product-edit popups.
export default function BatchSerialLabels({ mode, labelSizes }: { mode: 'batch' | 'serial'; labelSizes?: LabelSpec[] }) {
  return <BatchSerialLabelPicker mode={mode} labelSizes={labelSizes ?? LABEL_SIZES} />
}
