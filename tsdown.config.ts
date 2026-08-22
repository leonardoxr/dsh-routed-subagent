import { defineConfig } from 'tsdown'

// Browser half: one CJS bundle the Harness module loader script-loads from
// /plugins/<id>/client.js. React is bundled (the loader provides no shared
// React entry on all supported hosts).
//
// The loader contract requires every bundle to register itself through
// window.__ModuleLoader__.load({ id, factory }). The loader invokes the
// factory with only `require`, so the wrapper declares its own module/exports
// pair for the CJS body to populate. outExtensions forces a .js name because
// the served URL is fixed at /plugins/<id>/client.js.
const id = 'dsh-routed-subagent'

export default defineConfig({
  entry: { client: './src/client/index.ts' },
  outDir: 'client',
  format: 'cjs',
  platform: 'browser',
  target: 'es2022',
  outExtensions: () => ({ js: '.js' }),
  banner: `__ModuleLoader__.load({ id: ${JSON.stringify(id)}, factory: function (require) {`
    + ` const module = { exports: {} }; const exports = module.exports;`,
  footer: `return module.exports; } });`,
})
