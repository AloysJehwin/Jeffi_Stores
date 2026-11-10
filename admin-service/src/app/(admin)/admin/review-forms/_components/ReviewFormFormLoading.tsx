import { LoadingForm, Sk } from '@/components/admin/kit/skeleton'

const label = 'mb-1.5 block text-xs font-medium text-foreground-secondary'

const TEMPLATES = [
  { label: 'Google Review', description: 'Send customers to Google, then collect their screenshot' },
  { label: 'Product Feedback', description: 'Collect ratings and written feedback on a purchase' },
  { label: 'Testimonial', description: 'Gather a written testimonial with optional photo' },
]

/** ReviewFormForm (fields beside the live preview) while the add / edit page loads. */
export default function ReviewFormFormLoading() {
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 items-start gap-8 lg:grid-cols-2">
        <div className="space-y-5">
          <div>
            <p className={label}>Template *</p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              {TEMPLATES.map((t, i) => (
                <div key={t.label} className={`flex flex-col gap-1.5 rounded-xl border-2 p-3 ${i === 0 ? 'border-accent-500 bg-accent-500/5' : 'border-border-default'}`}>
                  <Sk className="h-5 w-5" />
                  <span className={`text-sm font-semibold ${i === 0 ? 'text-accent-500' : 'text-foreground'}`}>{t.label}</span>
                  <span className="text-xs leading-snug text-foreground-muted">{t.description}</span>
                </div>
              ))}
            </div>
          </div>
          {['Form Title *', 'Slug *', 'Google Review URL *', 'Reward Coupon'].map(l => (
            <div key={l}>
              <p className={label}>{l}</p>
              <Sk className="h-control rounded-lg" />
            </div>
          ))}
          <div>
            <p className={label}>Description</p>
            <Sk className="h-20 rounded-lg" />
          </div>
          <div>
            <p className={label}>Custom Fields</p>
            <Sk className="h-control rounded-lg" />
          </div>
        </div>
        <div>
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-foreground-muted">Live Preview</p>
          <Sk className="h-96 rounded-xl" />
        </div>
      </div>
      <LoadingForm sections={[]} />
    </div>
  )
}
