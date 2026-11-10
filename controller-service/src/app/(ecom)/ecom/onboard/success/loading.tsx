import { CheckMark } from '@controller/app/(ecom)/ecom/Shapes'
import { ConsoleHeaderLoading, Sk } from '../../dashboard/_components/Skeleton'
import ShellLoading from '../ShellLoading'
import { statusSteps } from '../steps'
import { primaryBtn } from '../ui'

export default function Loading() {
  const steps = statusSteps(true)
  return (
    <ShellLoading steps={steps} done={steps.length}>
      <div className="max-w-3xl">
        <ConsoleHeaderLoading eyebrow="Payment" title="Payment confirmed!" />
        <section className="rounded-2xl border border-border-default bg-surface-elevated p-6">
          <div className="flex items-start gap-3">
            <span className="inline-flex shrink-0 items-center justify-center w-9 h-9 rounded-full org-sage org-sage-text">
              <CheckMark className="w-5 h-5" />
            </span>
            <Sk className="mt-2 h-3.5 w-2/3" />
          </div>
          <span className={`${primaryBtn} mt-5 w-full sm:w-auto`}>Go to dashboard →</span>
        </section>
      </div>
    </ShellLoading>
  )
}
