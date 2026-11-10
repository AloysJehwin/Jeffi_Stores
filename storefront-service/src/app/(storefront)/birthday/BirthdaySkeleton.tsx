import { Sk } from '@/components/admin/kit/skeleton'

// The birthday form while the link is checked; the heading carries the customer's name.
export function BirthdayFormSkeleton({ className }: { className: string }) {
  return (
    <div className={className} role="status" aria-busy="true" aria-label="Loading">
      <p className="text-4xl">🎂</p>
      <Sk className="mt-3 h-6 w-4/5 mx-auto" />
      <p className="mt-2 text-sm text-foreground-secondary">
        Tell us once and we will send you a birthday treat every year.
      </p>
      <div className="mt-5 text-left">
        <span className="block text-xs font-medium text-foreground-secondary mb-1">Date of birth</span>
        <div className="w-full flex items-center justify-between h-control px-4 rounded-lg border border-border-secondary bg-surface text-sm">
          <span className="text-foreground-muted">dd/mm/yyyy</span>
          <svg className="w-4 h-4 text-foreground-muted shrink-0 ml-2" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 9v7.5"
            />
          </svg>
        </div>
      </div>
      <div className="mt-5 w-full px-4 py-2.5 rounded-lg bg-accent-500 text-white text-sm font-medium opacity-50">
        Save my birthday
      </div>
      <p className="mt-3 text-xs text-foreground-muted">We only use this to send you birthday offers.</p>
    </div>
  )
}
