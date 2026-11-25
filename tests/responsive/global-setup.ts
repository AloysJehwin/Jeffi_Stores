// Global setup: prepare.ts runs under tsx (it imports store-core through tsconfig.sweep.json and talks to the DB).
import { runTsx } from './tsx'

export default async function globalSetup() {
  runTsx('tests/responsive/prepare.ts')
}
