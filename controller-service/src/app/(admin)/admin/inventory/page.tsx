import InventoryClient from './InventoryClient'

export const dynamic = 'force-dynamic'

export default function InventoryPage() {
  return (
    <div className="p-4 sm:p-6">
      <div className="mb-6">
        <h1 className="text-2xl sm:text-3xl font-bold text-secondary-500 dark:text-foreground">Inventory</h1>
        <p className="text-foreground-secondary mt-1">Suppliers, purchase orders and stock ledger</p>
      </div>
      <InventoryClient />
    </div>
  )
}
