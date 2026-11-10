import { CardLoading, ConsoleHeaderLoading, Sk } from '../dashboard/_components/Skeleton'
import ShellLoading from './ShellLoading'

export default function Loading() {
  return (
    <ShellLoading>
      <div className="w-full space-y-6">
        <ConsoleHeaderLoading />
        <CardLoading>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="space-y-1.5">
                <Sk className="h-3.5 w-24" />
                <Sk className="h-10 w-full rounded-xl" />
              </div>
            ))}
          </div>
        </CardLoading>
      </div>
    </ShellLoading>
  )
}
