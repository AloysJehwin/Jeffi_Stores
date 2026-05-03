import Link from 'next/link'

export default function FormsTopNav() {
  return (
    <header style={{ background: '#1a3a4a' }} className="w-full">
      <div className="max-w-lg mx-auto px-4 py-3 flex items-center justify-between">
        <Link href="https://jeffistores.in" className="text-white font-bold text-base tracking-tight">
          Jeffi Store&apos;s
        </Link>
        <Link
          href="https://jeffistores.in"
          className="text-sm text-white/80 hover:text-white transition-colors"
        >
          Shop at Jeffi Stores →
        </Link>
      </div>
    </header>
  )
}
