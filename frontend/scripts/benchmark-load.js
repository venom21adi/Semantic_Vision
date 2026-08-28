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
 * Usage (from frontend/):
 *   node scripts/benchmark-load.js --repo "C:/AI_Voice/TTS/TTS" --label large
 *
 * Prints the result and appends a row to ../docs/PERFORMANCE-REPORT.md.
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
  const args = { timeout: 120000, label: 'unlabeled', app: 'http://localhost:5173' }
  const argv = process.argv.slice(2)
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--repo') args.repo = argv[++i]
    else if (argv[i] === '--label') args.label = argv[++i]
    else if (argv[i] === '--timeout') args.timeout = Number(argv[++i])
    else if (argv[i] === '--app') args.app = argv[++i]
  }
  if (!args.repo) {
    console.error(
      'Usage: node scripts/benchmark-load.js --repo <path> [--label <name>] [--timeout <ms>]',
    )
    process.exit(1)
  }
  return args
}

async function main() {
  const { repo, label, timeout, app } = parseArgs()
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
    await page.getByLabel('Repository path').fill(repo)

    const clickStart = Date.now()
    await page.getByRole('button', { name: /load/i }).click()

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
        // threshold every root arrives pre-checked, so `.check()` (which
        // no-ops if already checked, unlike `.click()`) is safe either way
        // -- this mirrors a real user opening a large repo and ticking its
        // top-level items, not a synthetic shortcut.
        const rootCheckboxes = page.locator(
          'ul[role="tree"] > li > div[role="treeitem"] > input[type="checkbox"]',
        )
        const rootCount = await rootCheckboxes.count()
        for (let i = 0; i < rootCount; i++) {
          await rootCheckboxes.nth(i).check()
        }

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

  report(result)
}

function report(result) {
  const dataStr = result.dataSeconds != null ? result.dataSeconds.toFixed(2) : '—'
  const renderStr = result.renderSeconds != null ? result.renderSeconds.toFixed(2) : '—'

  console.log(`\n${result.label} (${result.repo})`)
  console.log(`  status: ${result.status}`)
  console.log(`  time to data received: ${dataStr}s`)
  console.log(`  time to first node rendered: ${renderStr}s`)
  if (result.error) console.log(`  detail: ${result.error}`)

  const timestamp = new Date().toISOString().replace('T', ' ').slice(0, 16) + ' UTC'
  const header = '| Repo | Path | Status | Time to data (s) | Time to first render (s) |\n|---|---|---|---|---|'
  const row = `| ${result.label} | ${result.repo} | ${result.status} | ${dataStr} | ${renderStr} |`
  const section = `\n### ${timestamp} — frontend browser benchmark\n\n${header}\n${row}\n`

  if (!existsSync(dirname(REPORT_PATH))) mkdirSync(dirname(REPORT_PATH), { recursive: true })
  appendFileSync(REPORT_PATH, section, 'utf-8')
  console.log(`\nAppended to ${REPORT_PATH}`)
}

main()
