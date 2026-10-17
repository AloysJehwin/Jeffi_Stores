import Link from 'next/link'
import { ChevronRight } from 'lucide-react'

/** "Orders ›" link at the right of a section title. */
export function SectionLink({ href, label }: { href?: string; label?: string }) {
  if (!href || !label) return null
  return (
    <Link href={href} className="inline-flex items-center gap-0.5 text-xs font-medium text-accent-600 hover:text-accent-500 transition-colors">
      {label} <ChevronRight className="w-3.5 h-3.5" />
    </Link>
  )
}
