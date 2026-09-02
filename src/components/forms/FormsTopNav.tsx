import Link from 'next/link'
import { useStoreConfig } from '@/contexts/StoreConfigContext'

export default function FormsTopNav() {
  const storeConfig = useStoreConfig()
  const storeName = storeConfig.identity.name || 'Our Store'
  return (
    <header style={{ background: '#1a3a4a' }} className="w-full">
      <div className="max-w-lg mx-auto px-4 py-3 flex items-center justify-between">
        <Link href="https://jeffistores.in" className="text-white font-bold text-base tracking-tight">
          {storeName}
        </Link>
        <Link
          href="https://jeffistores.in"
          className="text-sm text-white/80 hover:text-white transition-colors"
        >
          Shop with us →
        </Link>
      </div>
    </header>
  )
}
