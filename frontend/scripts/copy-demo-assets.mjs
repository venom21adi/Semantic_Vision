// Copies frontend/demo-assets/ into dist/demo/ -- run only by `build:demo`,
// never by the plain `build` used for the real web/VS Code app. Kept
// outside frontend/public/ specifically so these fixtures (JSON + GIFs,
// several MB) don't get copied into *every* build the way anything under
// public/ unconditionally is -- see vscode-extension/scripts/copy-frontend.mjs
// for the same "explicit copy step, not implicit public/" convention.
import { cpSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const frontendRoot = path.resolve(fileURLToPath(import.meta.url), '..', '..')
const src = path.join(frontendRoot, 'demo-assets')
const dest = path.join(frontendRoot, 'dist', 'demo')

if (!existsSync(src)) {
  console.error(`copy-demo-assets: source not found at ${src}`)
  process.exit(1)
}
if (!existsSync(path.join(frontendRoot, 'dist'))) {
  console.error(`copy-demo-assets: dist/ not found -- run vite build first`)
  process.exit(1)
}

cpSync(src, dest, { recursive: true })
console.log(`copy-demo-assets: copied ${src} -> ${dest}`)
