# dsh-routed-subagent

Allowlisted model-and-reasoning routing for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness).
Every delegation call must choose both:

- a configured model policy through `model`; and
- one exact adapter-owned effort through `reasoning_effort`.

The plugin validates the pair against local policy and `ctx.llm.resolveCallConfig()` before creating a child. Arbitrary provider/model passthrough is never accepted.

## Install

```sh
dsh plugin --profile <your-profile> add github:leonardoxr/dsh-routed-subagent#v0.3.0
# or use the packed asset from the GitHub release / a local checkout:
dsh plugin --profile <your-profile> add C:/path/to/dsh-routed-subagent-0.3.0.tgz
```

## Configure

Target the `routed-subagent` row in your profile patch. `models` and `rootModels` are required to enable delegation. A fresh install without them starts normally and exposes its Settings card, but does not register a delegation tool until you configure a complete policy.

```yaml
- id: routed-subagent
  config:
    toolName: routed_subagent
    maxDepth: 2
    rootModels: [codex-mini, codex-sol]
    models:
      codex-mini:
        provider: openai-codex
        model: gpt-5.4-mini
        reasoningEfforts: [low, medium]
        maxTokens: 16384
        description: 'Mechanical edits, lookups, and summarization.'

      codex-sol:
        provider: openai-codex
        model: gpt-5.6-sol
        reasoningEfforts: [medium, high, xhigh]
        maxTokens: 65536
        description: 'Architecture, multi-step reasoning, and hard debugging.'
        spawnableModels: [codex-mini]
```

The mapping key (`codex-sol`) is the short policy id the calling agent passes as `model`; it is not sent to the provider. `provider` and the inner `model` select the actual adapter route.

## Configure in the app

**Settings → Plugins → Routed subagent** edits the complete router configuration: tool name, background-job support, maximum depth, root availability, model policies, provider/model routes, token caps, reasoning-effort allowlists, routing guidance, and recursive child permissions. Provider/model suggestions and effort ids come from the same live Host catalog as Chat; exact custom ids remain editable when the catalog is unavailable or intentionally incomplete.

Changes are staged until **Save changes**. A successful save hot-remounts the tool for new calls and invalidates recursive authority held by children from the previous settings generation. **Reset to composition** clears every router override.

## Tool contract

The registered tool accepts:

| Field | Required | Meaning |
| --- | --- | --- |
| `description` | yes | Short display label |
| `prompt` | yes | Complete standalone child task |
| `model` | yes | Configured model-policy id allowed in this caller context |
| `reasoning_effort` | yes | Exact effort allowlisted for that policy |
| `run_in_background` | no | Run through the Harness jobs service |

Foreground and background results echo the effective `{ id, provider, model, reasoningEffort }` selection for auditing.

## Configuration reference

| Key | Default | Meaning |
| --- | --- | --- |
| `toolName` | `routed_subagent` | Registered tool name |
| `enableRunInBackground` | `true` | Expose `run_in_background` |
| `maxDepth` | `1` | Positive finite absolute delegation-depth cap |
| `rootModels` | required | Non-empty policy ids available to top-level agents |
| `models` | required | Non-empty configured model allowlist |
| `models.*.provider` | required | Registered LLM provider route |
| `models.*.model` | required | Exact provider-owned model id |
| `models.*.reasoningEfforts` | required | Non-empty exact effort-id allowlist |
| `models.*.maxTokens` | — | Positive output-token cap |
| `models.*.description` | — | Short routing tradeoff shown to the caller |
| `models.*.spawnableModels` | `[]` | Policy ids children on this model may call |

Configuration is strict: unknown fields, duplicate ids, empty allowlists, unsafe numeric values, and unknown references fail load or save.

## Recursion and validation

- Only the local `spawn` subagent provider is used, because request-level reasoning enforcement and recursive authority require a live child `Agent`.
- An untracked agent at delegation depth greater than zero receives no model authority.
- Children receive only their selected policy's `spawnableModels` list.
- A settings generation change revokes deeper delegation for already-running children.
- The configured effort is captured per child and pinned on every LLM request, so concurrent children may use different efforts safely.
- `ctx.llm.resolveCallConfig()` validates the exact provider/model/effort combination before child creation. Missing adapters, stale model ids, and unsupported effort ids fail without spawning.

## Migrating from 0.2

Version 0.3 is intentionally breaking and has no tier compatibility layer:

- `tiers` → `models`
- `rootTiers` → required `rootModels`
- tier key `guidance` → model policy `description`
- tier key `spawnable` → `spawnableModels`
- remove `providerName`, `persona`, and static `reasoningEffort`
- replace tool argument `tier` with required `model` and `reasoning_effort`
- replace `maxDepth: provider-managed` with a positive integer

## Security note

Harness's `/api` trust fence is DNS-rebinding defense, not authentication. Anyone who can reach the server can initiate work available to its agents. Keep expensive routes out of `models` unless you accept that spend.

## License

[MIT](LICENSE)
