// Global setup: prepare.ts runs under tsx (it imports store-core through the root tsconfig paths and talks to the DB).
import path from 'node:path'
import { execFileSync } from 'node:child_process'

export default async function globalSetup() {
  execFileSync(path.join('node_modules', '.bin', 'tsx'), ['--tsconfig', 'tsconfig.json', 'tests/responsive/prepare.ts'], { stdio: 'inherit' })
}
