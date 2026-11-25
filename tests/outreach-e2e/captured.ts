// Prints what WhatsApp capture mode recorded for a contact, through the controller's own reader
// (readCapturedWhatsApp). Run under tsx by helpers.ts; jeffi_test only.
//   tsx --tsconfig tests/responsive/tsconfig.sweep.json tests/outreach-e2e/captured.ts <contactId>
import { loadLocalEnv } from '../responsive/env'

async function main(): Promise<void> {
  loadLocalEnv()
  const url = process.env.DATABASE_URL
  if (!url || !/test/i.test(new URL(url).pathname)) throw new Error('DATABASE_URL must point at jeffi_test')
  const { readCapturedWhatsApp } = await import('@controller/lib/outreach/whatsapp')
  const rows = await readCapturedWhatsApp({ contactId: process.argv[2] })
  process.stdout.write(JSON.stringify(rows) + '\n')
}

main()
  .then(() => process.exit(0))
  .catch(e => {
    console.error('[outreach-e2e] captured:', e instanceof Error ? e.message : e)
    process.exit(1)
  })
