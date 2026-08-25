// Copies the already-built `frontend/dist` into this package (`media/frontend`)
// so `context.extensionPath`-relative lookups in `src/extension.ts` find it in
// both the F5 Extension Development Host and a packaged VSIX. Run
// `npm run build` in `frontend/` first -- this script does not build it,
// only copies the output, so a stale `frontend/dist` copies stale content.
import { cpSync, existsSync, rmSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const here = path.dirname(fileURLToPath(import.meta.url))
const source = path.resolve(here, '..', '..', 'frontend', 'dist')
const destination = path.resolve(here, '..', 'media', 'frontend')

if (!existsSync(source)) {
  console.error(
    `frontend/dist not found at ${source} -- run "npm run build" in frontend/ first.`,
  )
  process.exit(1)
}

rmSync(destination, { recursive: true, force: true })
cpSync(source, destination, { recursive: true })
console.log(`Copied ${source} -> ${destination}`)
