# Contributing to dsh-routed-subagent

Thanks for your interest! This plugin follows the
[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) extension
conventions — a plugin is a TypeScript module exporting `apply(ctx, config)`,
registered capabilities dispose automatically with the plugin fiber.

## Development

```sh
npm install --legacy-peer-deps   # published dsh packages use loose prerelease peer ranges
npm run build                    # tsc -> lib/
npm test                         # vitest unit tests (tier-table logic)
npm run typecheck
```

The build targets the **published** `@deepseek-ai/*` packages (not the harness
monorepo workspace), so what compiles here is what runs under `dsh web` from an
npm install.

## Testing your changes against a live harness

```sh
npm pack
dsh plugin --profile <your-profile> add /path/to/dsh-routed-subagent-<version>.tgz
# add tiers config for row id "routed-subagent" in the profile's cordis.patch.yml
# restart your dsh web instance
```

The tool fails the load loudly when `tiers` is missing or invalid — that is
intentional (misconfiguration never fails silent).

## Pull requests

- One change per PR; keep `src/tiers.ts` pure (no harness imports) so the
  policy logic stays unit-testable.
- New config keys need: schema entry, validation in `parseTierTable`/`apply`,
  README reference-table row, and a test.
- CI runs typecheck + tests on every push and PR.

## Reporting issues

Include: harness version (`dsh --version`), install mode (npm global / source),
the failing tier config (redact provider credentials), and the tool error text.
