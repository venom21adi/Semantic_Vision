// Restructures dist/ for the public demo deployment: the built app (from
// vite build --mode demo, plus copy-demo-assets.mjs's dist/demo/) moves
// from dist/ to dist/app/, and the marketing landing page (frontend/landing/)
// takes over dist/ itself -- so the deployed site's root is the feature
// showcase, and the interactive tool lives at /app/. Run only by
// `build:demo`, after vite build and copy-demo-assets.mjs, never by the
// plain `build` used for the real web/VS Code app -- that one has no
// landing page and stays a single-page app at its own root.
import { cpSync, existsSync, mkdirSync, readdirSync, renameSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const frontendRoot = path.resolve(fileURLToPath(import.meta.url), '..', '..')
const dist = path.join(frontendRoot, 'dist')
const landingSrc = path.join(frontendRoot, 'landing')
const appDest = path.join(dist, 'app')

if (!existsSync(dist)) {
  console.error(`build-landing-site: dist/ not found -- run vite build first`)
  process.exit(1)
}
if (!existsSync(landingSrc)) {
  console.error(`build-landing-site: source not found at ${landingSrc}`)
  process.exit(1)
}

// Every relative asset path in the built app's index.html (base: './') is
// relative to that file's own location, so moving the whole built tree
// down one level into app/ -- rather than copying just index.html --
// keeps every ./assets/..., ./demo/..., ./favicon.png reference correct
// with zero rewriting.
mkdirSync(appDest, { recursive: true })
for (const entry of readdirSync(dist)) {
  if (entry === 'app') continue
  renameSync(path.join(dist, entry), path.join(appDest, entry))
}

// landing/ is plain, pre-built HTML/CSS/JS -- copied as-is directly into
// dist/ (its own index.html and img/ become dist/index.html, dist/img/).
cpSync(landingSrc, dist, { recursive: true })

console.log(`build-landing-site: app moved to ${appDest}, landing page now at ${dist}`)
