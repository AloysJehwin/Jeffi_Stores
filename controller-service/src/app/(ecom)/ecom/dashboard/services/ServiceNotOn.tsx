import { FileText, MessageSquare } from 'lucide-react'
import type { ApiService, ServiceState } from '@controller/lib/ecom/service-states'
import { REVIEW_TIME, SERVICE_NAME } from '@controller/lib/ecom/console-copy'
import { EmptyState } from '../_components/EmptyState'

/** The Messaging or Documents page of a workspace without that service: where it stands, and Services as the way on. */
export default function ServiceNotOn({ service, state }: { service: ApiService; state: ServiceState }) {
  const name = SERVICE_NAME[service]
  const copy =
    state.status === 'pending'
      ? { title: `${name} is awaiting approval`, body: `Jeffi is reviewing your request, usually within ${REVIEW_TIME}. We email you when it is on.`, label: 'See it on Services' }
      : state.status === 'rejected'
        ? { title: `${name} wasn’t approved`, body: state.note || 'See what is missing on Services, then request it again.', label: 'Request it again' }
        : { title: `${name} isn’t added yet`, body: `Add it on Services. Jeffi checks your business verification and reviews the request, usually within ${REVIEW_TIME}.`, label: `Add ${name}` }
  return (
    <EmptyState icon={service === 'messaging' ? MessageSquare : FileText} title={copy.title} action={{ href: '/dashboard/services', label: copy.label }}>
      {copy.body}
    </EmptyState>
  )
}
