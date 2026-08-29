// `highlight.js/lib/core` plus three hand-picked languages, not the full
// `highlight.js` bundle (~190 languages, ~1MB+) that a plain `import hljs
// from 'highlight.js'` would pull in -- this app only ever shows Python or
// JS/TS source, so registering just those three grammars keeps the added
// bundle weight to a few KB each instead. The `github-dark.css` theme is
// already loaded app-wide (`main.tsx`) for the AI-doc pane's code blocks
// (`rehype-highlight`), so no new CSS is needed either -- this reuses it.
import hljs from 'highlight.js/lib/core'
import javascript from 'highlight.js/lib/languages/javascript'
import python from 'highlight.js/lib/languages/python'
import typescript from 'highlight.js/lib/languages/typescript'

hljs.registerLanguage('python', python)
hljs.registerLanguage('javascript', javascript)
hljs.registerLanguage('typescript', typescript)

function languageForFile(file: string): string | null {
  if (file.endsWith('.py')) return 'python'
  if (file.endsWith('.ts') || file.endsWith('.tsx')) return 'typescript'
  if (file.endsWith('.js') || file.endsWith('.jsx')) return 'javascript'
  return null
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** Highlighted HTML (hljs's own output, already escaped) for `source`, or
 * `null` when `file`'s extension isn't one of the three registered
 * languages -- the caller falls back to plain (still escaped) text rather
 * than guessing at a grammar. */
export function highlightSource(source: string, file: string): { html: string; language: string } | null {
  const language = languageForFile(file)
  if (language === null) return null
  return { html: hljs.highlight(source, { language, ignoreIllegals: true }).value, language }
}

export function escapedPlainText(source: string): string {
  return escapeHtml(source)
}
