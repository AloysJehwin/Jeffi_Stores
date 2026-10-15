import fs from 'node:fs'
import path from 'node:path'

// Dev and tests run from the repo root (`next dev controller-service`); the image runs from
// /app/controller-service with database/ and certs/ one level up.
const has = (dir: string, entry: string) => fs.existsSync(path.join(dir, entry))

export function appRoot(): string {
  const cwd = process.cwd()
  const nested = path.join(cwd, 'controller-service')
  return !has(cwd, 'public') && has(nested, 'public') ? nested : cwd
}

export function repoRoot(): string {
  const cwd = process.cwd()
  const parent = path.dirname(cwd)
  return !has(cwd, 'database') && has(parent, 'database') ? parent : cwd
}

/** A path inside the Next project (public/, src/). */
export const appPath = (...p: string[]) => path.join(appRoot(), ...p)

/** A path at the repo root (database/, certs/, node_modules/, key files). */
export const repoPath = (...p: string[]) => path.join(repoRoot(), ...p)
