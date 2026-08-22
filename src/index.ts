/**
 * dsh-routed-subagent — complexity-routed subagent delegation.
 *
 * Registers a model-facing delegation tool whose input includes a runtime
 * `tier`; each configured tier names the provider, model, token cap, and
 * optional reasoning effort the spawned child runs under, plus the spawn chain
 * that child itself may delegate through. The calling model judges task
 * complexity per delegation and picks accordingly.
 *
 * Built entirely on public seams: `ctx.subagents.start()` already carries
 * per-start {@link AgentOptions}, and the agent-scoped `agent/request`
 * waterfall allows replacing the call config — so reasoning effort follows the
 * tier without any upstream change.
 */
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { Agent, AgentOptions } from '@deepseek-ai/dsh-agent'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { SubagentProvider, SubagentResult, SubagentRun } from '@deepseek-ai/dsh-subagent'
import { allowedTiersFor, parseTierTable, rootTierNames, type TierTable } from './tiers.ts'

export const name = 'routed-subagent'
export const inject = ['subagents', 'tools']

/** Plugin configuration (cordis.yml row config; flags never reach here). */
export interface Config {
  /** Registered tool name; must not collide with another mounted tool. Default `routed_subagent`. */
  toolName?: string
  /** Subagent provider name on `ctx.subagents`. Default `spawn` (the in-process spawn backend). */
  providerName?: string
  /** Expose `run_in_background` (default true); disabled instances omit the parameter. */
  enableRunInBackground?: boolean
  /**
   * Absolute delegation-depth cap for children started by this tool, or
   * `'provider-managed'` to leave recursion budget to the provider. Per-tier
   * spawn chains bound what deeper delegation may exist at all.
   */
  maxDepth?: number | 'provider-managed'
  /** Tier names top-level agents may use. Defaults to every configured tier. */
  rootTiers?: string[]
  /** Required tier table — see README. A missing or invalid table fails the load loudly. */
  tiers: unknown
}

export const Config: z<Config> = z.object({
  toolName: z.string().default('routed_subagent'),
  providerName: z.string().default('spawn'),
  enableRunInBackground: z.boolean().default(true),
  maxDepth: z.any().default('provider-managed'),
  rootTiers: z.any(),
  // Loose at the schema layer because Schemastery's mapping support is narrow;
  // `parseTierTable` validates strictly and fails the load with an actionable message.
  tiers: z.any(),
})

interface ForegroundToolResult {
  readonly kind: 'foreground'
  readonly runId: SubagentRun['id']
  readonly tier: string
  readonly output: unknown[]
}
/**
 * Collect and release one foreground run without letting disposal replace an
 * independent result failure (mirrors the stock tool adapter). `tier` rides
 * along so the canonical value names the runtime that produced the output.
 */
async function settleForegroundRun(run: SubagentRun, tier: string): Promise<ForegroundToolResult> {
  // The published 0.0.1-rc.x SubagentResult predates the diagnostic field;
  // detect it so newer runtimes light the path up without a breaking bump here.
  const diagnosticOf = (result: SubagentResult): string | undefined => {
    if (!('diagnostic' in result)) return undefined
    const value: unknown = result.diagnostic
    return typeof value === 'string' ? value : undefined
  }
  const [execution] = await Promise.allSettled([
    run.result.then((result) => {
      if (result.stopReason === 'completed') {
        return {
          kind: 'foreground' as const,
          runId: run.id,
          tier,
          output: result.output as unknown[],
        }
      }
      // Non-completed means partial output is not success, but the preserved
      // partial answer still reaches the parent via the thrown message.
      const diagnostic = diagnosticOf(result)
      const diagnosticText = diagnostic === undefined ? '' : `\nDiagnostic: ${diagnostic}`
      const text = result.output
        .filter((block): block is Extract<ContentBlock, { type: 'text' }> => block.type === 'text')
        .map(block => block.text)
        .join('')
      const partial = text.length === 0 ? '' : `\nPartial output before the run ended:\n${text}`
      throw new Error(`subagent run ended abnormally (${result.stopReason})${diagnosticText}${partial}`)
    }),
  ])
  const [disposal] = await Promise.allSettled([Promise.resolve().then(() => run.dispose())])
  if (execution.status === 'rejected') {
    if (disposal.status === 'rejected') {
      throw new AggregateError(
        [execution.reason, disposal.reason],
        `subagent run failed: ${String(execution.reason)}; dispose failed: ${String(disposal.reason)}`,
      )
    }
    throw execution.reason
  }
  if (disposal.status === 'rejected') throw disposal.reason
  return execution.value
}

/** Compose the static tool description: the routing contract plus the root tier menu. */
function toolDescription(toolName: string, tiers: TierTable, roots: readonly string[]): string {
  const menu = roots.map((tierName) => {
    const tier = tiers[tierName]
    if (tier === undefined) return tierName
    const guidance = tier.guidance ?? `${tier.provider}/${tier.model}`
    return `- "${tierName}": ${guidance}`
  }).join('\n')
  return 'Delegate a self-contained task to a subagent running on the runtime you pick with `tier`. '
    + 'Judge the delegated work honestly: simple lookups, mechanical edits, single-file changes, or '
    + 'summarization belong on a cheap fast tier; multi-step reasoning, architecture decisions, and hard '
    + 'debugging justify an expensive deep tier. The subagent works in its own context and returns its '
    + `result, not its intermediate steps, so give it a complete standalone prompt.\nTiers:\n${menu}\n`
    + `Deeper delegation may be restricted: a spawned child sees only the tiers its tier permits.`
}

export function apply(ctx: Context, config: Config): void {
  const tiers = parseTierTable(config.tiers)
  const roots = rootTierNames(tiers, config.rootTiers)
  const toolName = config.toolName ?? 'routed_subagent'
  const providerName = config.providerName ?? 'spawn'
  const backgroundEnabled = config.enableRunInBackground !== false
  const maxDepth = typeof config.maxDepth === 'number' ? config.maxDepth : undefined

  // Which tier each live spawned child runs under — the spawn-chain authority.
  const childTiers = new WeakMap<Agent, string>()

  // Reasoning effort follows the tier on every child request. Root-level
  // listener: scope-filtered dispatch delivers all agents here, and the
  // WeakMap narrows to children this plugin started.
  ctx.on('agent/request', async (_payload, next) => {
    const call = await next()
    const tierName = childTiers.get(_payload.agent)
    const effort = tierName === undefined ? undefined : tiers[tierName]?.reasoningEffort
    if (effort === undefined || call.reasoningEffort === effort) return call
    return { ...call, reasoningEffort: effort }
  })

  let disposeTool: (() => void) | undefined
  const mount = (provider: SubagentProvider): void => {
    if (typeof config.maxDepth === 'number' && !provider.capabilities.depthLimit) {
      throw new Error(
        `routed-subagent: provider "${provider.name}" cannot enforce maxDepth (no depthLimit capability)`
        + " — set maxDepth: 'provider-managed' to leave the recursion budget to the provider",
      )
    }
    const mounted = `routed-subagent: "${toolName}" mounted on provider "${provider.name}" — tiers: ${roots.join(', ')}`
    if (ctx.logger?.info) ctx.logger.info(mounted)
    else console.log(`[routed-subagent] ${mounted}`)
    disposeTool = ctx.tools.register(defineTool({
      name: toolName,
      description: toolDescription(toolName, tiers, roots),
      parameters: {
        description: {
          type: 'string',
          required: true,
          description: 'A short (3-5 word) description of the delegated task, for display.',
        },
        prompt: {
          type: 'string',
          required: true,
          description:
            'The complete, self-contained task for the subagent. It does not share this '
            + "conversation's context, so include everything it needs.",
        },
        tier: {
          type: 'string',
          required: true,
          description:
            'Runtime tier for this delegation, chosen by judging task complexity against the '
            + 'described tradeoffs. Availability can be narrower deeper in a delegation chain; '
            + 'an error names the tiers valid in the current context.',
        },
        ...backgroundEnabled ? {
          run_in_background: {
            type: 'boolean' as const,
            description:
              'Whether to run as a background job and return its id. Defaults to false; '
              + 'collect with job_output or stop with job_kill.',
          },
        } : {},
      },
      output: {
        schema: {
          oneOf: [
            {
              type: 'object',
              additionalProperties: false,
              properties: {
                kind: { type: 'string', required: true, const: 'background' },
                jobId: { type: 'string', required: true },
              },
            },
            {
              type: 'object',
              additionalProperties: false,
              properties: {
                kind: { type: 'string', required: true, const: 'foreground' },
                runId: { type: 'string', required: true },
                tier: { type: 'string', required: true },
                output: { type: 'array', required: true, items: { type: 'json' } },
              },
            },
          ],
        },
        render: (_args, value) => {
          if (value.kind === 'background') {
            return [{ type: 'text', text: `started background subagent job ${value.jobId}` }]
          }
          const text = (value.output as { text?: string }[])
            .map(block => (typeof block?.text === 'string' ? block.text : JSON.stringify(block)))
            .join('')
          return [{ type: 'text', text: `subagent [${String(value.tier)}] ${String(value.runId)}\n${text}` }]
        },
      },
      isConcurrencySafe: () => true,
      async execute(args, exec) {
        const caller = exec.agent
        if (!caller) {
          throw new Error('routed subagent requires a calling agent (exec.agent was undefined)')
        }
        const callerTier = childTiers.get(caller)
        const allowed = allowedTiersFor(tiers, roots, callerTier)
        if (!allowed.includes(args.tier)) {
          throw new Error(
            `tier "${args.tier}" is not available in this context`
            + `(allowed here: ${allowed.join(', ') || 'none'})`,
          )
        }
        const tier = tiers[args.tier]
        if (tier === undefined) throw new Error(`unknown tier "${args.tier}"`)
        const agentOptions: AgentOptions = {
          provider: tier.provider,
          model: tier.model,
          ...(tier.maxTokens !== undefined ? { maxTokens: tier.maxTokens } : {}),
        }
        const request = {
          label: args.description,
          prompt: [{ type: 'text', text: args.prompt }] as ContentBlock[],
          parent: caller,
          agentOptions,
          ...(tier.persona !== undefined ? { persona: tier.persona } : {}),
          ...(maxDepth !== undefined ? { maxDepth } : {}),
        }
        const track = (run: SubagentRun): SubagentRun => {
          if (run.localAgent !== undefined) childTiers.set(run.localAgent, args.tier)
          return run
        }

        if (args.run_in_background === true) {
          const jobs = ctx.get('jobs')
          if (jobs === undefined) {
            throw new Error('background jobs unavailable: load @deepseek-ai/dsh-jobs and @deepseek-ai/dsh-tool-jobs')
          }
          const id = jobs.start({
            kind: 'routed-subagent',
            label: args.description,
            owner: caller,
            run: () => {
              const controller = new AbortController()
              const start = ctx.subagents.start(providerName, { ...request, signal: controller.signal })
              return {
                cancel: (reason?: string) => {
                  controller.abort(reason ?? 'background routed subagent task killed')
                },
                done: (async () => {
                  try {
                    const started = await start
                    track(started)
                    // Settle the child turn work; the result value belongs to
                    // job_output consumers through the child session instead.
                    await started.result
                  } catch {
                    // done must not reject; infrastructure faults surface
                    // through job state, not the producer promise.
                  } finally {
                    try {
                      (await start).dispose()
                    } catch { /* disposal best-effort after settlement */ }
                  }
                })(),
              }
            },
          })
          return { kind: 'background' as const, jobId: id }
        }

        const run = track(await ctx.subagents.start(providerName, { ...request, signal: exec.signal }))
        return settleForegroundRun(run, args.tier)
      },
    }))
  }

  // Mirror provider lifecycle exactly like the stock adapter: sibling load
  // order and HMR replacement can change availability while this fiber lives.
  ctx.on('subagent/provider-added', (provider) => {
    if (provider.name === providerName && disposeTool === undefined) mount(provider)
  })
  ctx.on('subagent/provider-removed', (removed) => {
    if (removed !== providerName || disposeTool === undefined) return
    disposeTool()
    disposeTool = undefined
  })
  const present = ctx.subagents.getProvider(providerName)
  if (present !== undefined) {
    mount(present)
  } else {
    ctx.logger?.info(`routed-subagent: provider "${providerName}" not registered yet; the "${toolName}" tool will register when it appears`)
  }
}
