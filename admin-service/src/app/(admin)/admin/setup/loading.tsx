import { ListSkeleton, PageBody } from '@/components/admin/kit'

export default function Loading() {
  return (
    <PageBody>
      <ListSkeleton kpis={1} rows={6} cols={2} />
    </PageBody>
  )
}
