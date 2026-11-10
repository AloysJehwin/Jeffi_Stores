import { Sk } from '@/components/admin/kit/skeleton'

export default function Loading() {
  return (
    <div className="bg-surface min-h-screen" role="status" aria-busy="true" aria-label="Loading">
      <div className="container mx-auto max-w-2xl px-4 py-10 space-y-4">
        <h1 className="text-2xl font-bold text-foreground">Facebook data deletion</h1>
        <Sk className="h-4 w-4/5" />
        <Sk className="h-4 w-full" />
        <Sk className="h-3 w-2/3" />
      </div>
    </div>
  )
}
