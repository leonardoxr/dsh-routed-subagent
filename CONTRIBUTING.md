# Contributing to dsh-routed-subagent

Thanks for your interest! This plugin follows the
[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) extension
conventions — a plugin is a TypeScript module exporting `apply(ctx, config)`,
registered capabilities dispose automatically with the plugin fiber.

## Development

```sh
npm install --legacy-peer-deps   # published dsh packages use loose prerelease peer ranges
npm run build                    # tsc -> lib/
npm test                         # vitest unit tests (model policy and routing logic)
npm run typecheck
```

The build targets the **published** `@deepseek-ai/*` packages (not the harness
monorepo workspace), so what compiles here is what runs under `dsh web` from an
npm install.

## Testing your changes against a live harness

```sh
npm pack
dsh plugin --profile <your-profile> add /path/to/dsh-routed-subagent-<version>.tgz
# add rootModels and models config for row id "routed-subagent" in cordis.patch.yml
# restart your dsh web instance
```

The tool fails the load loudly when `models`, `rootModels`, or an exact model/effort
combination is invalid — that is intentional (misconfiguration never fails silent).

## Pull requests

- One change per PR; keep `src/model-policies.ts` pure (no Harness imports) so
  allowlist and recursive-authority logic stays unit-testable.
- New config keys need: Host and browser settings schema support, validation in
  `parseModelPolicyTable`/`resolveRuntimeRouterSettings`, a Settings card control,
  a README reference-table row, and a test.
- CI runs typecheck + tests on every push and PR.

## Reporting issues

Include: harness version (`dsh --version`), install mode (npm global / source),
the failing model policy (redact provider credentials), and the tool error text.
