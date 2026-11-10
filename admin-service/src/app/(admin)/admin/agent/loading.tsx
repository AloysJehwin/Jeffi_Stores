import { Bot } from 'lucide-react'
import { PageHeader } from '@/components/admin/kit/layout'
import { LoadingTabs, Sk } from '@/components/admin/kit/skeleton'

// The assistant page: header strip, tabs (Chat open), the empty chat and its composer.
export default function Loading() {
  return (
    <div className="h-full flex flex-col" role="status" aria-busy="true" aria-label="Loading Admin Assistant">
      <div className="px-4 sm:px-6 py-4 border-b border-border-default shrink-0">
        <PageHeader
          title="Admin Assistant"
          description="Your chats are private unless you share one. Changes need your approval."
          media={
            <div className="w-9 h-9 rounded-xl bg-accent-500 flex items-center justify-center shrink-0">
              <Bot className="w-5 h-5 text-white" />
            </div>
          }
        />
      </div>
      <div className="px-4 shrink-0">
        <LoadingTabs tabs={['Chat', 'Overview', 'Slash', 'Tools']} />
      </div>
      <div className="flex flex-1 min-h-0 flex-col">
        <div className="flex-1 min-h-0 p-4">
          <div className="text-center py-16">
            <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-accent-500 to-secondary-500 flex items-center justify-center mx-auto mb-4">
              <Bot className="w-7 h-7 text-white" />
            </div>
            <p className="text-sm font-medium text-foreground mb-1">How can I help?</p>
            <p className="text-xs text-foreground-muted max-w-sm mx-auto">
              Ask me anything about the store. I can search products, look up orders, summarise customers, propose
              actions for your approval.
            </p>
          </div>
        </div>
        <div className="border-t border-border-default p-3 shrink-0 flex items-end gap-2">
          <div className="flex-1 min-w-0 px-3 py-2 text-sm leading-5 bg-surface text-foreground-muted rounded-lg border border-border-secondary">
            Ask anything about the store
          </div>
          <Sk className="w-9 h-9 rounded-lg shrink-0" />
          <Sk className="w-9 h-9 rounded-lg shrink-0" />
        </div>
      </div>
    </div>
  )
}
