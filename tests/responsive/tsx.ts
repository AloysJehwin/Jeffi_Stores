import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

/** A script under tsx with tsconfig.sweep.json. tsx is found up the tree: a git worktree uses the main checkout's. */
export function runTsx(script: string, args: string[] = []) {
  for (let dir = process.cwd(); ; dir = path.dirname(dir)) {
    const bin = path.join(dir, 'node_modules', '.bin', 'tsx')
    if (fs.existsSync(bin)) return void execFileSync(bin, ['--tsconfig', 'tests/responsive/tsconfig.sweep.json', script, ...args], { stdio: 'inherit' })
    if (path.dirname(dir) === dir) throw new Error('tsx not found: run npm ci')
  }
}
