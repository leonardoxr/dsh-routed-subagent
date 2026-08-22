import { defineConfig } from 'tsdown'

// Browser half: one CJS bundle the Harness module loader script-loads from
// /plugins/<id>/client.js.
//
// The loader contract requires every bundle to register itself through
// window.__ModuleLoader__.load({ id, factory }). The loader invokes the
// factory with its own table-bound `require`, so the wrapper declares a
// require-shaped parameter and builds the module/exports pair the CJS body
// populates. outExtensions forces a .js name because the served URL is fixed
// at /plugins/<id>/client.js.
//
// React stays EXTERNAL: the shell seeds it as a platform singleton, and
// bundling it would drag Node-only `process.env` checks into the page.
const id = 'dsh-routed-subagent'

export default defineConfig({
  entry: { client: './src/client/index.ts' },
  outDir: 'client',
  format: 'cjs',
  platform: 'browser',
  target: 'es2022',
  outExtensions: () => ({ js: '.js' }),
  external: [/^react$/, /^react-dom(\/|$)/],
  banner: `__ModuleLoader__.load({ id: ${JSON.stringify(id)}, factory: function (require) {`
    + ` const module = { exports: {} }; const exports = module.exports;`,
  footer: `return module.exports; } });`,
})
