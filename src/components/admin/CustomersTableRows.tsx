'use client'

import Link from 'next/link'
import HoverCard from '@/components/ui/HoverCard'
import Tooltip from '@/components/ui/Tooltip'

export default function CustomersTableRows({ customers }: { customers: any[] }) {
  if (!customers.length) {
    return (
      <tr>
        <td colSpan={7} className="px-6 py-12 text-center text-foreground-muted">No customers found.</td>
      </tr>
    )
  }

  return (
    <>
      {customers.map((customer: any) => (
        <tr key={customer.id} className="hover:bg-surface-secondary">
          <td className="px-6 py-4 whitespace-nowrap">
            <HoverCard
              trigger={
                <span className="text-sm font-medium text-foreground underline decoration-dotted underline-offset-2 cursor-default hover:text-accent-500 transition-colors">
                  {[customer.first_name, customer.last_name].filter(Boolean).join(' ') || '—'}
                </span>
              }
              align="left"
              side="bottom"
              width="260px"
            >
              <div className="p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <p className="font-semibold text-foreground text-sm">
                    {[customer.first_name, customer.last_name].filter(Boolean).join(' ') || 'Unknown'}
                  </p>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                    customer.is_flagged ? 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300'
                    : customer.is_active ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300'
                    : 'bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-300'
                  }`}>
                    {customer.is_flagged ? 'Flagged' : customer.is_active ? 'Active' : 'Inactive'}
                  </span>
                </div>
                <div className="space-y-1 text-xs text-foreground-secondary">
                  <div className="flex items-center gap-2">
                    <svg className="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                    </svg>
                    <a href={`mailto:${customer.email}`} className="hover:text-accent-500 truncate">{customer.email}</a>
                  </div>
                  {customer.phone && (
                    <div className="flex items-center gap-2">
                      <svg className="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.948V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
                      </svg>
                      <span>{customer.phone}</span>
                    </div>
                  )}
                  <div className="flex items-center gap-2">
                    <svg className="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                    </svg>
                    <span>Joined {new Date(customer.created_at).toLocaleDateString('en-IN', { year: 'numeric', month: 'short', day: 'numeric' })}</span>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2 pt-1 border-t border-border-default">
                  <div className="text-center">
                    <p className="text-xs text-foreground-muted">Orders</p>
                    <p className="text-sm font-semibold text-foreground">{Number(customer.order_count)}</p>
                  </div>
                  <div className="text-center">
                    <p className="text-xs text-foreground-muted">Lifetime</p>
                    <p className="text-sm font-semibold text-foreground">
                      Rs.{Number(customer.lifetime_value || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                    </p>
                  </div>
                </div>
                <div className="pt-1">
                  <Link href={`/admin/customers/${customer.id}`} className="text-xs text-accent-500 hover:text-accent-600 font-medium">
                    View full profile →
                  </Link>
                </div>
              </div>
            </HoverCard>
          </td>
          <td className="px-6 py-4 whitespace-nowrap">
            <div className="text-sm text-foreground">{customer.email}</div>
          </td>
          <td className="px-6 py-4 whitespace-nowrap">
            <div className="text-sm text-foreground">{customer.phone || '—'}</div>
          </td>
          <td className="px-6 py-4 whitespace-nowrap">
            <Tooltip content={new Date(customer.created_at).toLocaleString('en-IN', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}>
              <span className="text-sm text-foreground cursor-default">
                {new Date(customer.created_at).toLocaleDateString('en-IN')}
              </span>
            </Tooltip>
          </td>
          <td className="px-6 py-4 whitespace-nowrap">
            <Tooltip content={`${Number(customer.order_count)} total orders placed`}>
              <span className="text-sm text-foreground cursor-default">{Number(customer.order_count)}</span>
            </Tooltip>
          </td>
          <td className="px-6 py-4 whitespace-nowrap">
            <Tooltip content={
              customer.is_flagged ? 'Account flagged — potential fraud or policy violation' :
              customer.is_active ? 'Account in good standing' : 'Account deactivated'
            }>
              <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full cursor-default ${
                customer.is_flagged ? 'bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-300'
                : customer.is_active ? 'bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300'
                : 'bg-orange-100 dark:bg-orange-900/30 text-orange-800 dark:text-orange-300'
              }`}>
                {customer.is_flagged ? 'Flagged' : customer.is_active ? 'Active' : 'Inactive'}
              </span>
            </Tooltip>
          </td>
          <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
            <Link href={`/admin/customers/${customer.id}`} className="text-accent-500 hover:text-accent-600">View</Link>
          </td>
        </tr>
      ))}
    </>
  )
}
