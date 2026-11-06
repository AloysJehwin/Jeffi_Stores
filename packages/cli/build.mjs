// Single-file bundle (dependencies and the manifest inlined): dist/jeffi.js
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const dir = path.dirname(fileURLToPath(import.meta.url))
const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'))
const outfile = path.join(dir, 'dist/jeffi.js')

await build({
  entryPoints: [path.join(dir, 'src/index.ts')],
  outfile,
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'esm',
  legalComments: 'none',
  logLevel: 'warning',
  define: { __JEFFI_CLI_VERSION__: JSON.stringify(pkg.version) },
  // Bundled CommonJS (commander) still calls require() for node builtins.
  banner: { js: "#!/usr/bin/env node\nimport { createRequire as __jeffiRequire } from 'node:module';\nconst require = __jeffiRequire(import.meta.url);" },
})
fs.chmodSync(outfile, 0o755)
console.log(`${path.relative(process.cwd(), outfile)} ${(fs.statSync(outfile).size / 1024).toFixed(0)} KB (v${pkg.version})`)
