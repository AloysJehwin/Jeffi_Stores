// Global setup: prepare.ts runs under tsx (it imports store-core through tsconfig.sweep.json and talks to the DB).
import path from 'node:path'
import { execFileSync } from 'node:child_process'

export default async function globalSetup() {
  execFileSync(path.join('node_modules', '.bin', 'tsx'), ['--tsconfig', 'tests/responsive/tsconfig.sweep.json', 'tests/responsive/prepare.ts'], { stdio: 'inherit' })
}
