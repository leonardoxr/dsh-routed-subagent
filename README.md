# dsh-routed-subagent

Complexity-routed subagent delegation for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness).
The calling model judges each delegated task and picks the **runtime tier** —
provider, model, token cap, reasoning effort — it deserves. Spawn chains bound
what deeper delegation may exist at all.

Built only on public Harness seams (`ctx.subagents.start()` per-start
`agentOptions`, the agent-scoped `agent/request` waterfall). No upstream source
changes; works on CLI, plain `dsh web`, and community desktop distributions.

## Configure in the app

After install, **Settings → Plugins → Routed subagent** opens a structured
tier builder. Provider and model choices come from the same live Host catalog
as Chat, and each model exposes its adapter-owned reasoning levels. Each tier
also has dedicated controls for its name, token cap, persona, routing guidance,
and child-delegation allowlist. Tiers can be added, duplicated, reordered, or removed without
editing JSON. Changes are staged until saved, and the whole table can be
discarded or reset to composition. Saved edits apply to new delegations
immediately; no restart. Structural identity (`toolName`, `providerName`,
`maxDepth`) stays in composition.

The editor uses the Harness client settings-scope contract (`getSnapshot`,
`subscribe`, `set`, and `unset`), so it requires the browser half bundled with
current DSH releases.

## Install
```sh
dsh plugin --profile <your-profile> add dsh-routed-subagent   # once published
# or straight from a git checkout / packed tarball:
dsh plugin --profile <your-profile> add C:/path/to/dsh-routed-subagent
```

## Configure

The tool refuses to load without tiers — set them in your profile's patch layer
(`~/.dsh/profiles/<profile>/cordis.patch.yml`) by targeting row id
`routed-subagent`. A tier is one runtime; `spawnable` chains what its children
may hire:

```yaml
# Sol's main agent gets the full menu; GPT children stay inside the codex pool.
- id: routed-subagent
  config:
    toolName: subagent            # optional: replaces the stock name
    maxDepth: 'provider-managed'
    tiers:
      gpt-fast:
        provider: openai-codex        # your codex subscription route
        model: gpt-5.4-mini
        maxTokens: 16384
        guidance: 'Lookups, mechanical edits, single-file changes, summarization.'
      gpt-deep:
        provider: openai-codex
        model: gpt-5.6-sol
        maxTokens: 65536
        reasoningEffort: high         # applied via the agent/request waterfall
        guidance: 'Multi-step reasoning, architecture, hard debugging.'
        spawnable: [gpt-fast]         # deep children may hire fast helpers only
      gpt-cheap:
        provider: openai-codex
        model: gpt-5.6-luna
        maxTokens: 16384
        guidance: 'Lower-cost Codex work where speed matters more than deep reasoning.'
```

Per-agent menus come from composition: mount this row (with different
`toolName` + `tiers`) inside an [agent preset](https://github.com/deepseek-ai/deepseek-harness)
to give that preset its own delegation menu. An agent whose preset lacks the
row cannot delegate at all.

## Config reference

| Key | Default | Meaning |
| --- | --- | --- |
| `toolName` | `routed_subagent` | Registered tool name; keep distinct from the stock `subagent` tool |
| `providerName` | `spawn` | Subagent transport on `ctx.subagents` |
| `enableRunInBackground` | `true` | Expose `run_in_background` (jobs runtime required) |
| `maxDepth` | `'provider-managed'` | Numeric cap requires the provider's `depthLimit` capability |
| `rootTiers` | all tiers | Tiers top-level agents may use |
| `tiers.*.provider`, `.model` | required | Child request routing (`AgentOptions`) |
| `tiers.*.maxTokens` | – | Output-token cap for the child |
| `tiers.*.reasoningEffort` | – | Effort forced onto every child request |
| `tiers.*.persona` | – | Per-child persona override (needs persona capability) |
| `tiers.*.guidance` | – | One-line tradeoff shown to the calling model |
| `tiers.*.spawnable` | `[]` | Tier names children of this tier may delegate to |

## How the choice works

The tool description carries each tier's `guidance`; the model judges the
delegated work per call and picks `tier`. Deeper in a chain, the exposed menu
narrows to the caller tier's `spawnable` list — violating calls fail with a
message naming what *is* valid, so the model self-corrects.

## Security note

Harness's `/api` trust fence is DNS-rebinding defense, not authentication.
Whatever a delegated child can do, anyone who can reach the server can set in
motion. Keep expensive tiers behind routes whose accounts you accept spending.

## License

[MIT](LICENSE)
