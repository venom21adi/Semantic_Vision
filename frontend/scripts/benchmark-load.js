#!/usr/bin/env node
/**
 * Benchmarks a real browser load through the actual running app: time
 * from clicking Load to data received, and separately to the graph
 * actually rendering a node -- the two phases Milestone 18
 * (docs/PHASE-2-BUILD-PLAN.md) flagged as the two candidate
 * bottlenecks (backend/API round-trip vs. frontend dagre layout and
 * React Flow render), measured independently instead of guessed at.
 *
 * Assumes the backend (http://localhost:8000) and frontend
 * (http://localhost:5173) dev servers are already running.
 *
 * For any repo above GraphCanvas's 300-node threshold, the Codebase tree
 * starts with nothing selected (`visibleIds` empty, App.tsx) -- so after
 * data arrives, this script checks every top-level tree item's "Show on
 * canvas" checkbox before waiting for a node to render, the same action a
 * real user opening a large repo would take. Below the threshold every
 * root already arrives pre-checked, so this is a no-op there.
 *
 * Defaults to --language python (RepoLoader.tsx's own default); pass
 * --language javascript for a JS/TS repo -- otherwise it parses as Python,
 * matches 0 files, and reports "0 nodes, 0 edges" with no error banner,
 * which then hangs waiting for a node that was never going to render.
 *
 * Usage (from frontend/):
 *   node scripts/benchmark-load.js --repo "C:/AI_Voice/TTS/TTS" --label large
 *   node scripts/benchmark-load.js --repo "C:/Benchmarks/nest" --label nest --language javascript
 *
 * Prints the result and appends a row to ../docs/PERFORMANCE-REPORT.md,
 * unless --no-report is passed (e.g. a one-off benchmark published
 * elsewhere that shouldn't touch this project's own tracked iterations).
 * Never hangs indefinitely -- a load that doesn't finish within
 * --timeout (default 120s) is recorded as "TIMED OUT", the same
 * outcome a real user hitting an unresponsive tab would see.
 */
import { existsSync, mkdirSync, appendFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import { chromium } from 'playwright'

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPORT_PATH = join(__dirname, '..', '..', 'docs', 'PERFORMANCE-REPORT.md')

function parseArgs() {
  const args = {
    timeout: 120000,
    label: 'unlabeled',
    app: 'http://localhost:5173',
    noReport: false,
    language: 'python',
  }
  const argv = process.argv.slice(2)
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--repo') args.repo = argv[++i]
    else if (argv[i] === '--label') args.label = argv[++i]
    else if (argv[i] === '--timeout') args.timeout = Number(argv[++i])
    else if (argv[i] === '--app') args.app = argv[++i]
    else if (argv[i] === '--no-report') args.noReport = true
    else if (argv[i] === '--language') args.language = argv[++i]
  }
  if (!args.repo) {
    console.error(
      'Usage: node scripts/benchmark-load.js --repo <path> [--label <name>] ' +
        '[--timeout <ms>] [--language python|javascript|java|go] [--no-report]',
    )
    process.exit(1)
  }
  return args
}

const LANGUAGE_LABELS = {
  python: 'Python',
  javascript: 'JavaScript / TypeScript',
  java: 'Java',
  go: 'Go',
}

async function main() {
  const { repo, label, timeout, app, noReport, language } = parseArgs()
  const browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } })
  const result = {
    label,
    repo,
    dataSeconds: null,
    renderSeconds: null,
    status: 'unknown',
    error: null,
  }

  try {
    await page.goto(app, { timeout: 30000 })
    // The loader is a 3-step wizard (path -> languages -> save location).
    // Language detection pre-checks *every* language found at the path, and a
    // polyglot repo (e.g. Hugo's JS assets next to its Go) would otherwise
    // load several languages at once and skew the timing -- so make the
    // selection exactly the requested language. Loading a language the repo
    // has none of selects 0 matching files and reports "0 nodes, 0 edges" with
    // no error banner, which would then hang waiting for a node that was never
    // going to render.
    await page.getByLabel('Repository path').fill(repo)
    await page.getByRole('button', { name: /next: pick languages/i }).click()
    const wanted = LANGUAGE_LABELS[language]
    if (!wanted) throw new Error(`Unknown --language ${language}`)
    const group = page.getByRole('group', { name: 'Languages to parse' })
    await group.waitFor({ timeout: 30000 })
    for (const label of Object.values(LANGUAGE_LABELS)) {
      const box = group.getByLabel(`Load ${label}`, { exact: true })
      if ((await box.count()) === 0) continue
      if (label === wanted) await box.check()
      else await box.uncheck()
    }
    await page.getByRole('button', { name: /next: save location/i }).click()

    const clickStart = Date.now()
    await page.getByRole('button', { name: /^load$/i }).click()

    const dataOk = await page
      .waitForSelector('[data-testid="repo-status"]', { timeout })
      .then(() => true)
      .catch(() => false)

    if (!dataOk) {
      result.status = 'TIMED OUT (data)'
    } else {
      result.dataSeconds = (Date.now() - clickStart) / 1000

      // GraphCanvas's own "Large graph, rendering may be slow" banner is
      // also `role="alert"` (for a11y announcement), not a load failure --
      // only RepoLoader's actual API-error alert should count as one.
      const errorLocator = page.getByRole('alert').filter({ hasNotText: /large graph/i }).first()
      if (await errorLocator.isVisible().catch(() => false)) {
        result.status = 'ERROR'
        result.error = await errorLocator.textContent().catch(() => null)
      } else {
        // The Codebase tree starts with `visibleIds` empty for any repo
        // above GraphCanvas's 300-node threshold (App.tsx) -- nothing
        // renders until a root item's checkbox is checked. Below the
        // threshold every root arrives pre-checked, so a real DOM
        // `.click()` on an already-checked box would wrongly *uncheck*
        // it -- skip those, mirroring `.check()`'s no-op behavior. A
        // repo whose root itself is a wide, flat directory (confirmed on
        // webpack's `lib/`: 157 direct entries) makes one Playwright
        // action per checkbox -- each with its own actionability/scroll
        // wait -- the dominant cost, well before layout even starts.
        // Dispatching every click from inside the page in one batch
        // keeps this a real click per checkbox (still fires React's
        // onChange, unlike setting `.checked` directly) without paying
        // that per-action round-trip 157 times over.
        // `repo-status` appears as soon as data arrives, which can be a beat
        // before the tree has mounted its root items -- clicking before they
        // exist would silently click nothing and then time out on render.
        await page.waitForSelector('ul[role="tree"] > li input[type="checkbox"]', { timeout })
        await page.evaluate(() => {
          const boxes = document.querySelectorAll(
            'ul[role="tree"] > li > div[role="treeitem"] > input[type="checkbox"]',
          )
          for (const box of boxes) {
            if (!box.checked) box.click()
          }
        })

        const renderOk = await page
          .waitForSelector('.react-flow__node', { timeout })
          .then(() => true)
          .catch(() => false)
        if (renderOk) {
          result.renderSeconds = (Date.now() - clickStart) / 1000
          result.status = 'OK'
        } else {
          result.status = 'TIMED OUT (render)'
        }
      }
    }
  } catch (err) {
    result.status = 'ERROR'
    result.error = err.message
  } finally {
    await browser.close()
  }

  report(result, noReport)
}

function report(result, noReport) {
  const dataStr = result.dataSeconds != null ? result.dataSeconds.toFixed(2) : '—'
  const renderStr = result.renderSeconds != null ? result.renderSeconds.toFixed(2) : '—'

  console.log(`\n${result.label} (${result.repo})`)
  console.log(`  status: ${result.status}`)
  console.log(`  time to data received: ${dataStr}s`)
  console.log(`  time to first node rendered: ${renderStr}s`)
  if (result.error) console.log(`  detail: ${result.error}`)

  if (noReport) return

  const timestamp = new Date().toISOString().replace('T', ' ').slice(0, 16) + ' UTC'
  const header = '| Repo | Path | Status | Time to data (s) | Time to first render (s) |\n|---|---|---|---|---|'
  const row = `| ${result.label} | ${result.repo} | ${result.status} | ${dataStr} | ${renderStr} |`
  const section = `\n### ${timestamp} — frontend browser benchmark\n\n${header}\n${row}\n`

  if (!existsSync(dirname(REPORT_PATH))) mkdirSync(dirname(REPORT_PATH), { recursive: true })
  appendFileSync(REPORT_PATH, section, 'utf-8')
  console.log(`\nAppended to ${REPORT_PATH}`)
}

main()
