import { BirthdayFormSkeleton } from './BirthdaySkeleton'

export default function Loading() {
  return (
    <div className="min-h-screen bg-surface flex items-center justify-center p-4">
      <BirthdayFormSkeleton className="bg-surface-elevated rounded-2xl shadow-sm border border-border-default p-6 sm:p-8 max-w-sm w-full text-center" />
    </div>
  )
}
