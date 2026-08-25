import { describe, expect, it } from 'vitest'
import { buildCsp, getNonce, injectBootstrap, rewriteAssetPaths } from './webviewContent'

const SAMPLE_HTML = `<!doctype html>
<html>
  <head>
    <link rel="icon" type="image/png" href="./favicon.png" />
    <script type="module" crossorigin src="./assets/index-ABC123.js"></script>
    <link rel="stylesheet" crossorigin href="./assets/index-DEF456.css">
  </head>
  <body>
    <div id="root"></div>
  </body>
</html>
`

describe('getNonce', () => {
  it('produces a 32-character alphanumeric string, different on each call', () => {
    const a = getNonce()
    const b = getNonce()

    expect(a).toMatch(/^[A-Za-z0-9]{32}$/)
    expect(a).not.toBe(b)
  })
})

describe('rewriteAssetPaths', () => {
  it('rewrites every relative asset reference to the webview resource root', () => {
    const result = rewriteAssetPaths(SAMPLE_HTML, 'vscode-webview://abc123/dist', 'nonce123')

    expect(result).toContain('href="vscode-webview://abc123/dist/favicon.png"')
    expect(result).toContain('src="vscode-webview://abc123/dist/assets/index-ABC123.js"')
    expect(result).toContain('href="vscode-webview://abc123/dist/assets/index-DEF456.css"')
  })

  it('adds the nonce to the bundle module script tag so the CSP allows it to run', () => {
    const result = rewriteAssetPaths(SAMPLE_HTML, 'vscode-webview://abc123/dist', 'nonce123')

    expect(result).toContain('<script type="module" nonce="nonce123"')
  })

  it('strips crossorigin from the script and stylesheet tags', () => {
    // Vite adds `crossorigin` to both by default, which puts the browser
    // into CORS-mode fetching for them -- the `vscode-webview://` resource
    // host doesn't reliably answer with matching CORS headers, so the
    // request is silently blocked with no visible error and the panel
    // renders blank. Confirmed as the actual cause of a real blank-screen
    // report during this milestone's manual smoke test.
    const result = rewriteAssetPaths(SAMPLE_HTML, 'vscode-webview://abc123/dist', 'nonce123')

    expect(result).not.toContain('crossorigin')
  })
})

describe('buildCsp', () => {
  it('scopes connect-src to exactly the configured backend URL, not a wildcard', () => {
    const csp = buildCsp('vscode-webview://abc123', 'http://localhost:8000', 'nonce123')

    expect(csp).toContain('connect-src http://localhost:8000')
    expect(csp).not.toContain('connect-src *')
  })

  it('scopes script-src to the webview resource root plus the bundle nonce', () => {
    const csp = buildCsp('vscode-webview://abc123', 'http://localhost:8000', 'nonce123')

    expect(csp).toContain("script-src vscode-webview://abc123 'nonce-nonce123'")
  })

  it('allows the layout worker to load via its own worker-src directive', () => {
    // A CSP nonce only applies to HTML elements carrying that nonce
    // attribute, never to a `new Worker(url)` call -- without this,
    // worker-src falling back to a nonce-only script-src would block the
    // graph layout worker outright (a real gap test-critic caught: the
    // graph would never actually render inside the webview).
    const csp = buildCsp('vscode-webview://abc123', 'http://localhost:8000', 'nonce123')

    expect(csp).toContain('worker-src vscode-webview://abc123')
  })
})

describe('injectBootstrap', () => {
  it('injects the CSP meta tag and the runtime globals before </head>', () => {
    const result = injectBootstrap(SAMPLE_HTML, 'default-src none', 'nonce123', 'http://localhost:9999')

    expect(result).toContain('<meta http-equiv="Content-Security-Policy" content="default-src none">')
    expect(result).toContain('window.__SEMANTIC_VISION_VSCODE__ = true;')
    expect(result).toContain('window.__SEMANTIC_VISION_API_BASE__ = "http://localhost:9999";')
    expect(result.indexOf('__SEMANTIC_VISION_VSCODE__')).toBeLessThan(result.indexOf('</head>'))
  })

  it('uses the given nonce on the injected bootstrap script tag', () => {
    const result = injectBootstrap(SAMPLE_HTML, 'default-src none', 'nonce123', 'http://localhost:9999')

    expect(result).toContain('<script nonce="nonce123">')
  })
})
