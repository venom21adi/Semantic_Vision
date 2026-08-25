import * as fs from 'fs'
import * as path from 'path'
// Type-only: the real `vscode` module only exists inside a running
// extension host, not as an importable package -- a top-level runtime
// `import` here would make this whole file (including the pure,
// unit-tested functions below) fail to load under Vitest/plain Node.
// `buildWebviewHtml` below does a scoped runtime `require('vscode')`
// instead, deferred until it's actually called.
import type * as vscode from 'vscode'

export function getNonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  let nonce = ''
  for (let i = 0; i < 32; i += 1) {
    nonce += chars.charAt(Math.floor(Math.random() * chars.length))
  }
  return nonce
}

/** Rewrites the built `frontend/dist/index.html`'s relative asset
 * references (`./assets/...`, `./favicon.png` -- relative per
 * `vite.config.ts`'s `base: './'`) to the webview's own
 * `vscode-webview://` resource root, adds a nonce to the bundle's
 * `<script type="module">` tag so the CSP below (`script-src
 * 'nonce-...'`) allows it to run, and strips the `crossorigin` attribute
 * Vite adds to the script/stylesheet tags by default. That attribute
 * puts the browser into CORS-mode fetching for those two resources --
 * fine over a real http(s) origin, but the `vscode-webview://` resource
 * host doesn't reliably answer with matching CORS headers, so the
 * request is silently blocked with no error surfaced anywhere but the
 * *webview's own* devtools console (never the extension host's Debug
 * Console) -- the script/stylesheet never load, and the panel renders
 * as a blank/black screen with no visible cause. A known, documented
 * gotcha for embedding a Vite build in a VS Code webview, not
 * hypothetical -- confirmed as the actual cause of exactly this symptom
 * during this milestone's manual smoke test. Pure string transform -- no
 * `vscode` API calls -- so it's unit-testable without a real extension
 * host. */
export function rewriteAssetPaths(html: string, resourceRoot: string, nonce: string): string {
  const withRewrittenAssets = html.replace(
    /(src|href)="\.\/(.*?)"/g,
    (_match, attr: string, relativePath: string) => `${attr}="${resourceRoot}/${relativePath}"`,
  )
  const withoutCrossorigin = withRewrittenAssets.replace(/\s+crossorigin(?=[\s>])/g, '')
  return withoutCrossorigin.replace('<script type="module"', `<script type="module" nonce="${nonce}"`)
}

/** VS Code refuses to render a webview without a CSP. `script-src`/
 * `style-src` are scoped to the webview's own resource root (plus the
 * bundle's nonce); `connect-src` is scoped to exactly the configured
 * backend URL, not a wildcard -- the built frontend calls it directly
 * (see `frontend/src/api/client.ts`'s runtime override), so it needs
 * network permission to exactly that one origin and nothing else.
 *
 * `worker-src` is its own directive, not left to fall back to
 * `script-src`: the built frontend spawns a real dedicated Worker for
 * graph layout (`frontend/src/graph/useLayoutWorker.ts`'s
 * `./layout.worker?worker` import, confirmed as its own emitted chunk by
 * building the frontend) via `new Worker(url)`, and a nonce -- unlike a
 * host/scheme source -- only applies to HTML elements carrying that
 * nonce attribute, never to a `new Worker(url)` call. Without an
 * explicit `worker-src ${cspSource}`, the fallback-to-`script-src`
 * behavior would see only a nonce source and block the worker outright,
 * silently breaking graph layout inside the webview -- confirmed as a
 * real gap by `test-critic`, not hypothetical. `script-src` also keeps
 * `cspSource` alongside the nonce for the same reason (defense in depth
 * for any other same-origin script-loading path). */
export function buildCsp(cspSource: string, backendUrl: string, nonce: string): string {
  return [
    "default-src 'none'",
    `img-src ${cspSource} data:`,
    `style-src ${cspSource} 'unsafe-inline'`,
    `font-src ${cspSource}`,
    `script-src ${cspSource} 'nonce-${nonce}'`,
    `worker-src ${cspSource}`,
    `connect-src ${backendUrl}`,
  ].join('; ')
}

/** Injects the CSP meta tag and the two runtime globals the built bundle
 * reads before its own script runs: `__SEMANTIC_VISION_API_BASE__`
 * (`frontend/src/api/client.ts`) and `__SEMANTIC_VISION_VSCODE__`
 * (`frontend/src/App.tsx`, gates the jump-to-source/message-bridge
 * behavior that only makes sense inside this webview). Pure string
 * transform, unit-testable without a real extension host. */
export function injectBootstrap(html: string, csp: string, nonce: string, backendUrl: string): string {
  const bootstrap = `
    <meta http-equiv="Content-Security-Policy" content="${csp}">
    <script nonce="${nonce}">
      window.__SEMANTIC_VISION_VSCODE__ = true;
      window.__SEMANTIC_VISION_API_BASE__ = ${JSON.stringify(backendUrl)};
    </script>`
  return html.replace('</head>', `${bootstrap}\n  </head>`)
}

/** Thin glue over the pure functions above -- the only part of this
 * module that touches the real `vscode`/`fs` APIs, so it isn't itself
 * unit-tested (no `vscode` module exists outside a real extension host);
 * covered instead by the manual Extension Development Host smoke test. */
export function buildWebviewHtml(
  webview: vscode.Webview,
  distDir: string,
  backendUrl: string,
): string {
  // eslint-disable-next-line @typescript-eslint/no-var-requires -- see the
  // module-level comment on the `import type` above.
  const vscodeApi: typeof vscode = require('vscode')
  const html = fs.readFileSync(path.join(distDir, 'index.html'), 'utf-8')
  const resourceRoot = webview.asWebviewUri(vscodeApi.Uri.file(distDir)).toString()
  const nonce = getNonce()

  const withAssets = rewriteAssetPaths(html, resourceRoot, nonce)
  const csp = buildCsp(webview.cspSource, backendUrl, nonce)
  return injectBootstrap(withAssets, csp, nonce, backendUrl)
}
