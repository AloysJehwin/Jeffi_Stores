import ShelvingClient from './ShelvingClient'

export const dynamic = 'force-dynamic'

export default function ShelvingPage() {
  return (
    <div className="h-full flex flex-col">
      <ShelvingClient />
    </div>
  )
}
