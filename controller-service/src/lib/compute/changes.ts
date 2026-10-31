import { SERVICE_NAMES, type ComputeSpec } from '@/lib/compute/spec'

/** What applying `next` to a store running `current` will do, in the owner's words. */
export function describeChange(current: ComputeSpec, next: ComputeSpec, applyMode: 'window' | 'now') {
  const notes: string[] = []
  const a = current.node
  const d = next.node
  if (current.db.mode !== next.db.mode) {
    notes.push(
      `Your store goes offline for a few minutes while its data is copied to ${next.db.mode === 'dedicated' ? 'its own database' : 'a shared database'}. The old database is kept for a day.`
    )
  }
  const sameServers = a.placement === d.placement && a.type === d.type
  if (!sameServers || d.count < a.count) {
    notes.push(
      d.placement === 'pool'
        ? 'Your store moves onto shared servers, one service copy at a time, then its own servers are removed. It stays up.'
        : 'New servers start, your services move onto them one copy at a time, then the old ones are removed. Your store stays up.'
    )
  } else if (d.count > a.count) {
    notes.push(`${d.count - a.count} more server${d.count - a.count > 1 ? 's' : ''} join; new copies spread across them.`)
  }
  if (sameServers && d.count >= a.count && SERVICE_NAMES.some(k => JSON.stringify(current.services[k]) !== JSON.stringify(next.services[k]))) {
    notes.push('Services restart one copy at a time. Your store stays up.')
  }
  const classChange = next.db.mode === 'dedicated' && current.db.mode === 'dedicated' && current.db.class !== next.db.class
  if (next.db.mode === 'dedicated' && current.db.mode === 'dedicated') {
    if (next.db.storageGb > current.db.storageGb) notes.push(`Database storage grows to ${next.db.storageGb} GB, with no downtime.`)
    if (next.db.multiAz !== current.db.multiAz) notes.push(`A standby database is ${next.db.multiAz ? 'added' : 'removed'}, with no downtime.`)
    if (classChange) {
      const offline = current.db.multiAz ? 'a minute or two' : '5 to 10 minutes'
      notes.push(
        applyMode === 'now'
          ? `The database changes size now; your store is offline for about ${offline}.`
          : `The database changes size in its next weekly maintenance window; your store is offline for about ${offline} then.`
      )
    }
  }
  return { notes, classChange }
}
