# Changelog

## 0.2.1

- Fixed the module-loader wrapper: the factory receives only `require`, so it
  now creates its own `module`/`exports` pair (0.2.0 bundles threw
  `Object.defineProperty called on non-object` at import).
- Client output forced to `client.js`, the path the loader serves.

## 0.2.0

- **In-app tier editing**: Settings → Plugins → Routed subagent edits the tier
  table through the client settings scope — staged draft, explicit save,
  reset-to-composition — hot-applied to new delegations without a restart
  (`agent/request` effort override included).
- Host settings namespace `routed-subagent` registered via the canonical
  `installSettingsSection` wiring, falling back to the composition entry when
  no settings service exists.
- Tool re-registers on committed section changes so the model-facing tier menu
  stays current.
- Browser half ships as `client/client.js` (CJS bundle wrapped in the
  module-loader registration contract, React included); `dsh.client` manifest
  declares the web platform.
- Fixed: the package now declares its `dsh.bundle` manifest (required by the
  profile loader) and ships the built browser bundle.

## 0.1.0

- Initial release: complexity-routed delegation tool, per-tier runtime
  selection (`provider`, `model`, `maxTokens`, `reasoningEffort`, `persona`),
  per-tier spawnable chains, root menu allowlist, background jobs support.
