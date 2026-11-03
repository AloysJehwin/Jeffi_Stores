import { CopyValue } from '@/components/admin/kit/actions'

/** A long id or endpoint: monospace, wraps anywhere, with a copy button. */
export default function Copyable({ value }: { value: string | null | undefined }) {
  if (!value) return <span className="text-foreground-muted">—</span>
  return (
    <span className="inline-flex min-w-0 max-w-full items-start gap-1.5">
      <span className="min-w-0 font-mono text-xs break-all">{value}</span>
      <CopyValue value={value} />
    </span>
  )
}
