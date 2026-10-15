// One-off WhatsApp approval sync across platform + all tenants (the service also runs this every
// WA_APPROVAL_SYNC_MS, default 10 min). Run: npm run wa:sync
import { syncAll } from '../src/wa-approval.js'

const r = await syncAll(m => console.warn(m))
console.log(`[wa-sync] checked=${r.checked} changed=${r.changed}`)
process.exit(0) // tenant pools stay open otherwise
