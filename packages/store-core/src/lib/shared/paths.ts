import fs from 'node:fs'
import path from 'node:path'

// Dev and tests run from the repo root (`next dev <app>-service`); an image runs from /app/<app>-service
// with database/, the services' database/ folders, certs/ and packages/ one level up. JEFFI_APP is set by each app's next.config.
const has = (dir: string, entry: string) => fs.existsSync(path.join(dir, entry))
const APP_DIR = `${process.env.JEFFI_APP || 'controller'}-service`

export function appRoot(): string {
  const cwd = process.cwd()
  const nested = path.join(cwd, APP_DIR)
  return !has(cwd, 'public') && has(nested, 'public') ? nested : cwd
}

// The root is the folder with database/extensions.sql: each service has a database/ of its own, the root's alone has that file.
const ROOT_MARKER = path.join('database', 'extensions.sql')

export function repoRoot(): string {
  const cwd = process.cwd()
  const parent = path.dirname(cwd)
  return !has(cwd, ROOT_MARKER) && has(parent, ROOT_MARKER) ? parent : cwd
}

/** A path inside the Next project (public/, src/). */
export const appPath = (...p: string[]) => path.join(appRoot(), ...p)

/** A path at the repo root (database/, <service>/database/, certs/, node_modules/, key files). */
export const repoPath = (...p: string[]) => path.join(repoRoot(), ...p)

/** A file the server reads from disk (fonts, PDF images), shared by every app. */
export const assetPath = (...p: string[]) => repoPath('packages', 'store-core', 'assets', ...p)
