import * as path from 'path'
import * as vscode from 'vscode'
import {
  isBackendReachable,
  resolveBundledBackendPath,
  resolvePort,
  spawnBackend,
  spawnBundledBackend,
  waitForBackend,
} from './backend'
import { findNodeAtCursor, type GraphNodeLike } from './graphLookup'
import { isWithinRoot, toRelativePath } from './paths'
import { buildWebviewHtml } from './webviewContent'

let panel: vscode.WebviewPanel | undefined

/** The last-fetched graph, cached per workspace root so
 * `impactAnalysisAtCursor` doesn't re-fetch on every invocation --
 * cleared/refetched whenever `openGraph` runs again for a (possibly
 * different) root. */
let cachedGraph: { nodes: GraphNodeLike[] } | null = null
let cachedGraphRoot: string | null = null

/** Coalesces concurrent `ensureBackendRunning` calls onto one in-flight
 * check/spawn -- without this, invoking `openGraph` and
 * `impactAnalysisAtCursor` close together (or `openGraph` twice quickly)
 * while the backend is down and `backendPath` is configured could each
 * independently see "not reachable yet" and each call `spawnBackend`,
 * racing two `uvicorn` processes for the same port. */
let ensureBackendPromise: Promise<boolean> | null = null

interface Config {
  backendUrl: string
  backendPath: string
}

function getConfig(): Config {
  const config = vscode.workspace.getConfiguration('semanticVision')
  return {
    backendUrl: config.get<string>('backendUrl', 'http://localhost:8000'),
    backendPath: config.get<string>('backendPath', ''),
  }
}

function workspaceRoot(): string | undefined {
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
}

async function doEnsureBackendRunning(config: Config, extensionPath: string): Promise<boolean> {
  if (await isBackendReachable(config.backendUrl)) return true

  if (config.backendPath) {
    void vscode.window.showInformationMessage(
      `Starting the Semantic Vision backend from ${config.backendPath}...`,
    )
    spawnBackend(config.backendPath, resolvePort(config.backendUrl), (error) => {
      void vscode.window.showErrorMessage(
        `Semantic Vision: failed to start the backend from ${config.backendPath}: ${error.message}. ` +
          'Check that "uv" is on PATH and that this path is a real Semantic Vision checkout.',
      )
    })

    const reachable = await waitForBackend(config.backendUrl)
    if (!reachable) {
      void vscode.window.showErrorMessage(
        `Semantic Vision backend still isn't reachable at ${config.backendUrl} after starting it ` +
          `from ${config.backendPath}. Check that "uv sync" has been run there.`,
      )
    }
    return reachable
  }

  // No backendPath configured -- the public Marketplace case (Milestone
  // 19, Part A). Prefer the binary bundled inside this extension's own
  // install, if this platform's build shipped one, over asking the user
  // to set up Python at all.
  const bundledPath = resolveBundledBackendPath(extensionPath)
  if (bundledPath) {
    void vscode.window.showInformationMessage('Starting the Semantic Vision backend...')
    spawnBundledBackend(bundledPath, resolvePort(config.backendUrl), (error) => {
      void vscode.window.showErrorMessage(
        `Semantic Vision: failed to start the bundled backend: ${error.message}.`,
      )
    })

    // A one-file PyInstaller binary re-extracts itself to a temp directory
    // on every launch before Python even starts -- measured at up to ~30s
    // cold (Windows, this milestone's spike binary) versus a live `uv run
    // uvicorn` process, which is typically reachable within a couple of
    // seconds. `waitForBackend`'s 15s default budget (tuned for the latter)
    // isn't enough here, so this path gets a longer one. This is a one-time
    // cost per backend launch, not per command -- the process stays up
    // across subsequent `openGraph`/`impactAnalysisAtCursor` calls.
    const reachable = await waitForBackend(config.backendUrl, 45, 1000)
    if (!reachable) {
      void vscode.window.showErrorMessage(
        `Semantic Vision backend still isn't reachable at ${config.backendUrl} after starting it.`,
      )
    }
    return reachable
  }

  const action = await vscode.window.showErrorMessage(
    `Semantic Vision backend isn't reachable at ${config.backendUrl}. Start it yourself ` +
      `("uv run uvicorn semantic_vision.api.app:app --port <port>" from a Semantic Vision ` +
      'checkout), or set "semanticVision.backendPath" to let this extension start it for you.',
    'Open Settings',
  )
  if (action === 'Open Settings') {
    void vscode.commands.executeCommand('workbench.action.openSettings', 'semanticVision.backendPath')
  }
  return false
}

/** Checks the configured backend, and starts it if it's not reachable --
 * from `backendPath` when set (Milestone 16's original dev flow,
 * unchanged), otherwise from this install's own bundled binary when one
 * exists (Milestone 19, Part A). Without either, this never guesses a
 * location to spawn from; it tells the user how to start it themselves
 * instead, since a wrong guess would fail confusingly (see
 * `docs/PHASE-2-BUILD-PLAN.md` Milestone 16 and this session's research:
 * there's no console-script entry point, so `cwd` must be a real Semantic
 * Vision checkout with `uv sync` already run there). */
async function ensureBackendRunning(config: Config, extensionPath: string): Promise<boolean> {
  if (ensureBackendPromise) return ensureBackendPromise
  ensureBackendPromise = doEnsureBackendRunning(config, extensionPath).finally(() => {
    ensureBackendPromise = null
  })
  return ensureBackendPromise
}

async function fetchGraph(backendUrl: string, root: string): Promise<{ nodes: GraphNodeLike[] } | null> {
  try {
    const response = await fetch(`${backendUrl}/api/graph?path=${encodeURIComponent(root)}`)
    if (!response.ok) return null
    return (await response.json()) as { nodes: GraphNodeLike[] }
  } catch {
    return null
  }
}

function postActiveFile(root: string, absoluteFile: string) {
  if (!panel) return
  void panel.webview.postMessage({
    command: 'activeFileChanged',
    file: toRelativePath(root, absoluteFile),
  })
}

async function openSource(root: string, relativeFile: string, line: number) {
  const uri = vscode.Uri.file(path.join(root, relativeFile))
  const document = await vscode.workspace.openTextDocument(uri)
  const editor = await vscode.window.showTextDocument(document, vscode.ViewColumn.One)
  const position = new vscode.Position(Math.max(0, line - 1), 0)
  editor.selection = new vscode.Selection(position, position)
  editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenter)
}

function ensurePanel(context: vscode.ExtensionContext, backendUrl: string): vscode.WebviewPanel {
  if (panel) {
    panel.reveal(vscode.ViewColumn.Beside)
    return panel
  }

  const distDir = path.join(context.extensionPath, 'media', 'frontend')
  panel = vscode.window.createWebviewPanel(
    'semanticVisionGraph',
    'Semantic Vision',
    vscode.ViewColumn.Beside,
    {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [vscode.Uri.file(distDir)],
    },
  )
  panel.webview.html = buildWebviewHtml(panel.webview, distDir, backendUrl)

  context.subscriptions.push(
    panel.webview.onDidReceiveMessage((message: { command?: string; file?: string; line?: number }) => {
      const root = workspaceRoot()
      if (!root) return
      if (message.command === 'openSource' && message.file && typeof message.line === 'number') {
        void openSource(root, message.file, message.line)
      }
    }),
  )

  panel.onDidDispose(() => {
    panel = undefined
  })

  return panel
}

async function openGraph(context: vscode.ExtensionContext) {
  const root = workspaceRoot()
  if (!root) {
    void vscode.window.showErrorMessage('Semantic Vision: open a folder first.')
    return
  }

  const config = getConfig()
  const ready = await ensureBackendRunning(config, context.extensionPath)
  if (!ready) return

  await fetch(`${config.backendUrl}/api/parse-repo`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: root }),
  })
  cachedGraph = await fetchGraph(config.backendUrl, root)
  cachedGraphRoot = root

  ensurePanel(context, config.backendUrl)

  const activeFile = vscode.window.activeTextEditor?.document.uri.fsPath
  if (activeFile && isWithinRoot(root, activeFile)) {
    postActiveFile(root, activeFile)
  }
}

async function impactAnalysisAtCursor(context: vscode.ExtensionContext) {
  const editor = vscode.window.activeTextEditor
  const root = workspaceRoot()
  if (!editor || !root) return

  const config = getConfig()
  if (!cachedGraph || cachedGraphRoot !== root) {
    const ready = await ensureBackendRunning(config, context.extensionPath)
    if (!ready) return
    cachedGraph = await fetchGraph(config.backendUrl, root)
    cachedGraphRoot = root
  }
  if (!cachedGraph) {
    void vscode.window.showErrorMessage('Semantic Vision: could not load the graph for this workspace.')
    return
  }

  const file = toRelativePath(root, editor.document.uri.fsPath)
  const line = editor.selection.active.line + 1
  const node = findNodeAtCursor(cachedGraph.nodes, file, line)
  if (!node) {
    void vscode.window.showInformationMessage('Semantic Vision: no function or class found at the cursor.')
    return
  }

  ensurePanel(context, config.backendUrl)
  void panel?.webview.postMessage({ command: 'runImpactAnalysis', nodeId: node.id })
}

export function activate(context: vscode.ExtensionContext) {
  context.subscriptions.push(
    vscode.commands.registerCommand('semanticVision.openGraph', () => openGraph(context)),
    vscode.commands.registerCommand('semanticVision.impactAnalysisAtCursor', () =>
      impactAnalysisAtCursor(context),
    ),
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      const root = workspaceRoot()
      if (editor && root && isWithinRoot(root, editor.document.uri.fsPath)) {
        postActiveFile(root, editor.document.uri.fsPath)
      }
    }),
  )
}

export function deactivate() {
  panel = undefined
  cachedGraph = null
  cachedGraphRoot = null
  ensureBackendPromise = null
}
