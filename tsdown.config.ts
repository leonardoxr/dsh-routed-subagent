import { defineConfig } from 'tsdown'

// Browser half: one CJS bundle the Harness module loader script-loads from
// /plugins/<id>/client.js. React is bundled (the loader provides no shared
// React entry on all supported hosts).
//
// The loader contract requires every bundle to register itself through
// window.__ModuleLoader__.load({ id, factory }): the banner opens the factory,
// the CJS body populates `module.exports`, and the footer hands it back.
const id = 'dsh-routed-subagent'

export default defineConfig({
  entry: { client: './src/client/index.ts' },
  outDir: 'client',
  format: 'cjs',
  platform: 'browser',
  target: 'es2022',
  banner: `__ModuleLoader__.load({ id: ${JSON.stringify(id)}, factory: function (require, module, exports) {`,
  footer: `return module.exports; } });`,
})
