import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // A VS Code webview serves the built bundle from a `vscode-webview://`
  // resource root, not `/` -- absolute asset paths (the default) break
  // there. Relative paths work identically in a normal browser/dev-server
  // load, so this is safe for every existing usage too.
  base: './',
  server: {
    port: 5173,
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    // The default `forks` pool spawns child processes, which is blocked
    // in some sandboxed dev environments; `threads` works everywhere.
    pool: 'threads',
    server: {
      // Vitest externalizes node_modules by default, loading them via
      // Node's native resolver rather than Vite's transform pipeline --
      // which means vi.mock('d3-drag', ...) in setup.ts (needed to
      // avoid a jsdom/d3-drag incompatibility, see setup.ts) can't
      // intercept it unless it's inlined instead.
      deps: {
        inline: ['@xyflow/react', '@xyflow/system', 'd3-drag'],
      },
    },
  },
})
