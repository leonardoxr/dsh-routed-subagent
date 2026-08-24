/**
 * Configured model-and-reasoning subagent router.
 *
 * Every delegation call selects one allowlisted model policy and one exact
 * reasoning effort. The host validates that pair before a local child exists;
 * immutable child tracking then applies the same selection to every request and
 * bounds any deeper delegation by model policy and absolute depth.
 */
import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { defineTool, type JsonValue } from '@deepseek-ai/dsh-tools'
import { installSettingsSection, settingsNamespace } from '@deepseek-ai/dsh-settings'
import type { Agent, AgentOptions } from '@deepseek-ai/dsh-agent'
import { ReasoningEffortId, type ContentBlock, type LlmCallConfig } from '@deepseek-ai/dsh-llm'
import { settleRun, type SubagentProvider, type SubagentResult, type SubagentRun } from '@deepseek-ai/dsh-subagent'
import {
  allowedModelPolicyIds,
  parseModelPolicyTable,
  resolveModelSelection,
  rootModelPolicyIds,
  type ModelPolicyTable,
  type ModelSelection,
} from './model-policies.ts'
export type { ModelPolicy, ModelPolicyTable, ModelSelection } from './model-policies.ts'

declare module '@deepseek-ai/dsh-agent' {
  interface AgentOptions {
    /** Exact process-local correlation for routed child publication. */
    dshRoutedSubagentToken?: string
  }
}

/** Settings namespace carrying every user-editable router option. */
export const ROUTED_SUBAGENT_SETTINGS_NAMESPACE = settingsNamespace('routed-subagent')

export interface RoutedSettingsSection {
  toolName?: string
  enableRunInBackground?: boolean
  maxDepth?: unknown
  models?: unknown
  rootModels?: unknown
}

/** Complete router settings section owned by Settings → Plugins. */
export const SETTINGS_SCHEMA: z<RoutedSettingsSection> = z.object({
  toolName: z.string().default('routed_subagent'),
  enableRunInBackground: z.boolean().default(true),
  maxDepth: z.any().default(1),
  models: z.any().default({}),
  rootModels: z.any(),
})

export const name = 'routed-subagent'
export const inject = ['subagents', 'tools', 'llm', 'agents']

/** Plugin configuration. This is intentionally incompatible with the old tier schema. */
export interface Config {
  /** Registered tool name. Default routed_subagent. */
  toolName?: string
  /** Expose run_in_background. Default true. */
  enableRunInBackground?: boolean
  /** Absolute positive delegation-depth cap. Default 1. */
  maxDepth?: number
  /** Non-empty model-policy ids available to true top-level agents when enabled. */
  rootModels?: readonly string[]
  /** Model policy allowlist. The plugin stays inert until this is configured. */
  models?: ModelPolicyTable
}

export const Config: z<Config> = z.object({
  toolName: z.string().default('routed_subagent'),
  enableRunInBackground: z.boolean().default(true),
  maxDepth: z.any().default(1),
  rootModels: z.any(),
  models: z.any(),
})

/** Auditable route chosen for one delegation. */
export type EffectiveSelection = ModelSelection

export interface ForegroundToolResult {
  readonly kind: 'foreground'
  readonly runId: SubagentRun['id']
  readonly selection: EffectiveSelection
  readonly output: JsonValue[]
}

export interface BackgroundToolResult {
  readonly kind: 'background'
  readonly jobId: string
  readonly selection: EffectiveSelection
}

export type RoutedSubagentToolResult = ForegroundToolResult | BackgroundToolResult

type BackgroundJobOutcome = Awaited<ReturnType<typeof settleRun>>
type TrackRun = (run: SubagentRun) => SubagentRun | Promise<SubagentRun>

/** Validate the finite absolute depth cap. */
export function resolveMaxDepth(value: unknown): number {
  const resolved = value === undefined ? 1 : value
  if (typeof resolved !== 'number' || !Number.isSafeInteger(resolved) || resolved < 1) {
    throw new Error('routed-subagent: maxDepth must be a positive safe integer')
  }
  return resolved
}

/** Validate a registered tool name from composition or Settings. */
export function resolveToolName(value: unknown): string {
  const resolved = value === undefined ? 'routed_subagent' : value
  if (typeof resolved !== 'string' || resolved.trim() === '' || resolved !== resolved.trim()
    || /[\u0000-\u001f\u007f]/u.test(resolved)) {
    throw new Error('routed-subagent: toolName must be a non-empty trimmed string')
  }
  return resolved
}

export interface RuntimeRouterSettings {
  readonly toolName: string
  readonly enableRunInBackground: boolean
  readonly maxDepth: number
  readonly policies: ModelPolicyTable
  readonly roots: readonly string[]
}

function isUnconfiguredRouterSettings(value: RoutedSettingsSection): boolean {
  const hasModels = value.models !== undefined
    && (typeof value.models !== 'object' || value.models === null || Array.isArray(value.models)
      || Object.keys(value.models).length > 0)
  const hasRoots = value.rootModels !== undefined
    && (!Array.isArray(value.rootModels) || value.rootModels.length > 0)
  return !hasModels && !hasRoots
}

/**
 * A newly installed router has no safe provider/model policy to expose yet.
 * Keep its settings card available, but do not register a delegation tool until
 * the user supplies a complete policy table.
 */
export function resolveOptionalRuntimeRouterSettings(value: RoutedSettingsSection): RuntimeRouterSettings | undefined {
  return isUnconfiguredRouterSettings(value) ? undefined : resolveRuntimeRouterSettings(value)
}

/** Parse one complete settings snapshot before it can remount the tool. */
export function resolveRuntimeRouterSettings(value: RoutedSettingsSection): RuntimeRouterSettings {
  const policies = parseModelPolicyTable(value.models)
  return {
    toolName: resolveToolName(value.toolName),
    enableRunInBackground: value.enableRunInBackground !== false,
    maxDepth: resolveMaxDepth(value.maxDepth),
    policies,
    roots: rootModelPolicyIds(policies, value.rootModels),
  }
}

export interface CallConfigResolver {
  resolveCallConfig(config: LlmCallConfig, signal?: AbortSignal): Promise<LlmCallConfig>
}

/** Validate one configured pair authoritatively and derive child AgentOptions. */
export async function validateExactModelSelection(
  resolver: CallConfigResolver,
  requested: EffectiveSelection,
  maxTokens: number | undefined,
  signal?: AbortSignal,
): Promise<{ selection: EffectiveSelection; agentOptions: AgentOptions }> {
  const resolved = await resolver.resolveCallConfig({
    provider: requested.provider,
    model: requested.model,
    reasoningEffort: ReasoningEffortId(requested.reasoningEffort),
    ...(maxTokens === undefined ? {} : { maxTokens }),
  }, signal)
  if (resolved.provider !== requested.provider
    || resolved.model !== requested.model
    || resolved.reasoningEffort !== requested.reasoningEffort) {
    throw new Error('routed-subagent: adapter resolved a different explicit model selection')
  }
  return {
    selection: requested,
    agentOptions: {
      provider: resolved.provider,
      model: resolved.model,
      ...(resolved.maxTokens === undefined ? {} : { maxTokens: resolved.maxTokens }),
    },
  }
}

/** Pin one tracked child's immutable provider/model/effort choice on a request. */
export function pinModelSelection(call: LlmCallConfig, selection: EffectiveSelection): LlmCallConfig {
  const effort = ReasoningEffortId(selection.reasoningEffort)
  if (call.provider === selection.provider && call.model === selection.model && call.reasoningEffort === effort) {
    return call
  }
  return { ...call, provider: selection.provider, model: selection.model, reasoningEffort: effort }
}

/** Serialize only provider publication for one parent while child runs remain concurrent. */
export class PerAgentStartGate {
  private readonly tails = new WeakMap<object, Promise<void>>()

  async run<T>(owner: object, task: () => Promise<T>): Promise<T> {
    const previous = this.tails.get(owner) ?? Promise.resolve()
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    const tail = previous.then(() => gate)
    this.tails.set(owner, tail)
    await previous
    try {
      return await task()
    } finally {
      release()
      if (this.tails.get(owner) === tail) this.tails.delete(owner)
    }
  }
}

/** Settle a background start into the jobs registry's terminal outcome. */
export async function settleBackgroundStart(
  start: Promise<SubagentRun>,
  signal: AbortSignal,
  track: TrackRun = run => run,
): Promise<BackgroundJobOutcome> {
  let run: SubagentRun
  try {
    run = await start
  } catch (error) {
    return signal.aborted && !(error instanceof AggregateError)
      ? { status: 'killed' }
      : { status: 'failed', detail: String(error) }
  }
  try {
    return await settleRun(await track(run))
  } catch (error) {
    return { status: 'failed', detail: String(error) }
  }
}

/** Collect and release one foreground run while preserving independent failures. */
async function settleForegroundRun(
  run: SubagentRun,
  selection: EffectiveSelection,
): Promise<ForegroundToolResult> {
  const diagnosticOf = (result: SubagentResult): string | undefined => {
    if (!('diagnostic' in result)) return undefined
    const value: unknown = result.diagnostic
    return typeof value === 'string' ? value.slice(0, 4000) : undefined
  }
  const [execution] = await Promise.allSettled([
    run.result.then((result) => {
      if (result.stopReason === 'completed') {
        return {
          kind: 'foreground' as const,
          runId: run.id,
          selection,
          output: result.output as unknown as JsonValue[],
        }
      }
      const diagnostic = diagnosticOf(result)
      const diagnosticText = diagnostic === undefined ? '' : '\nDiagnostic: ' + diagnostic
      const text = result.output
        .filter((block): block is Extract<ContentBlock, { type: 'text' }> => block.type === 'text')
        .map(block => block.text)
        .join('')
        .slice(0, 8000)
      const partial = text.length === 0 ? '' : '\nPartial output before the run ended:\n' + text
      throw new Error('subagent run ended abnormally (' + result.stopReason + ')' + diagnosticText + partial)
    }),
  ])
  const [disposal] = await Promise.allSettled([Promise.resolve().then(() => run.dispose())])
  if (execution.status === 'rejected') {
    if (disposal.status === 'rejected') {
      throw new AggregateError(
        [execution.reason, disposal.reason],
        'subagent run failed: ' + String(execution.reason) + '; dispose failed: ' + String(disposal.reason),
      )
    }
    throw execution.reason
  }
  if (disposal.status === 'rejected') throw disposal.reason
  return execution.value
}

function modelMenu(policies: ModelPolicyTable, roots: readonly string[]): string {
  return roots.map((policyId) => {
    const policy = policies[policyId]
    if (policy === undefined) return '- "' + policyId + '"'
    const description = policy.description === undefined ? '' : ' — ' + policy.description
    return '- "' + policyId + '": ' + policy.provider + '/' + policy.model
      + '; reasoning_effort: [' + policy.reasoningEfforts.join(', ') + ']' + description
  }).join('\n')
}

/** Compose the routing contract and configured root menu the calling model reads. */
export function toolDescription(policies: ModelPolicyTable, roots: readonly string[]): string {
  return 'Delegate a self-contained task to a local subagent. You must choose both a configured model policy '
    + 'with model and one of that policy\'s explicit reasoning efforts with reasoning_effort on every call. '
    + 'Use cheaper/faster choices for mechanical work and deeper effort only when complexity justifies it. '
    + 'The child works in its own context and returns its result, not intermediate reasoning, so provide a '
    + 'complete standalone prompt.\nAvailable model policies:\n' + modelMenu(policies, roots) + '\n'
    + 'Deeper delegation is fail-closed and may expose a narrower model list.'
}

interface TrackedChild {
  readonly generation: number
  readonly selection: EffectiveSelection
}

interface PendingChild extends TrackedChild {
  readonly token: string
}

function selectionSchema() {
  return {
    type: 'object' as const,
    required: true,
    additionalProperties: false,
    properties: {
      id: { type: 'string' as const, required: true },
      provider: { type: 'string' as const, required: true },
      model: { type: 'string' as const, required: true },
      reasoningEffort: { type: 'string' as const, required: true },
    },
  } as const
}

export function apply(ctx: Context, config: Config): void {
  const fallback: RoutedSettingsSection = {
    toolName: resolveToolName(config.toolName),
    enableRunInBackground: config.enableRunInBackground !== false,
    maxDepth: resolveMaxDepth(config.maxDepth),
    models: config.models ?? {},
    rootModels: config.rootModels ?? [],
  }
  let settings = resolveOptionalRuntimeRouterSettings(fallback)
  let readSettings: () => unknown = () => fallback
  let generation = 0
  const providerName = 'spawn'

  const childPolicies = new WeakMap<Agent, TrackedChild>()
  const pendingStarts = new WeakMap<Agent, PendingChild>()
  const startGate = new PerAgentStartGate()
  let disposeTool: (() => void) | undefined
  let mountedProvider: SubagentProvider | undefined

  const remount = (): void => {
    const next = resolveOptionalRuntimeRouterSettings(readSettings() as RoutedSettingsSection)
    const provider = mountedProvider
    const previousDispose = disposeTool
    if (next === undefined) {
      previousDispose?.()
      disposeTool = undefined
      settings = undefined
      generation += 1
      return
    }
    if (provider === undefined) {
      settings = next
      generation += 1
      return
    }

    if (previousDispose === undefined) {
      disposeTool = registerTool(provider, next)
      settings = next
      generation += 1
      return
    }

    const previous = settings
    if (previous === undefined) {
      throw new Error('routed-subagent: internal remount state is inconsistent')
    }
    if (next.toolName !== previous.toolName) {
      // Different names can be registered atomically. A collision leaves the
      // old registration untouched.
      const nextDispose = registerTool(provider, next)
      previousDispose()
      disposeTool = nextDispose
      settings = next
      generation += 1
      return
    }

    // The registry cannot hold two tools with the same name. Restore the exact
    // previous registration if replacement fails after disposal.
    previousDispose()
    disposeTool = undefined
    try {
      const nextDispose = registerTool(provider, next)
      disposeTool = nextDispose
      settings = next
      generation += 1
    } catch (error) {
      try {
        disposeTool = registerTool(provider, previous)
      } catch (restoreError) {
        throw new AggregateError([error, restoreError], 'routed-subagent: tool remount and rollback both failed')
      }
      throw error
    }
  }

  installSettingsSection(ctx, ROUTED_SUBAGENT_SETTINGS_NAMESPACE, SETTINGS_SCHEMA, fallback, {
    setSource(current) {
      readSettings = current
    },
    onChange() {
      remount()
    },
    validate(value) {
      const next = resolveOptionalRuntimeRouterSettings(value as RoutedSettingsSection)
      if (next === undefined) return
      if (next.toolName === 'run_code') {
        throw new Error('routed-subagent: toolName "run_code" is reserved')
      }
      if (next.toolName !== settings?.toolName && ctx.tools.get(next.toolName) !== undefined) {
        throw new Error('routed-subagent: toolName "' + next.toolName + '" is already registered')
      }
    },
  })

  // The package-specific AgentOptions token survives local child option
  // resolution. Bind the exact new Agent at publication, before session startup
  // and its first request; parent identity alone is deliberately insufficient.
  ctx.on('agent/created', ({ agent }) => {
    const token = agent.options.dshRoutedSubagentToken
    const parentId = agent.session.header.parentSession
    if (token === undefined || parentId === undefined) return
    const parent = ctx.agents.get(parentId)
    const pending = parent === undefined ? undefined : pendingStarts.get(parent)
    if (parent === undefined
      || pending === undefined
      || pending.token !== token
      || !ctx.agents.isOwnedBy(agent.session.header.id, parent)) return
    childPolicies.set(agent, { generation: pending.generation, selection: pending.selection })
  })

  // AgentOptions cannot carry reasoning effort. Apply each immutable child choice
  // at request time, also pinning provider/model against unrelated waterfalls.
  ctx.on('agent/request', async (payload, next) => {
    const call = await next()
    const tracked = childPolicies.get(payload.agent)
    if (tracked === undefined) return call
    return pinModelSelection(call, tracked.selection)
  })

  const registerTool = (provider: SubagentProvider, active: RuntimeRouterSettings): (() => void) => {
    const { toolName, enableRunInBackground: backgroundEnabled, maxDepth, policies, roots } = active
    if (!provider.capabilities.depthLimit) {
      throw new Error('routed-subagent: local spawn provider cannot enforce maxDepth')
    }
    const dispose = ctx.tools.register(defineTool({
      name: toolName,
      description: toolDescription(policies, roots),
      parameters: {
        description: {
          type: 'string',
          required: true,
          description: 'A short (3-5 word) description of the delegated task, for display.',
        },
        prompt: {
          type: 'string',
          required: true,
          description: 'The complete standalone task. The child does not share the parent conversation.',
        },
        model: {
          type: 'string',
          required: true,
          description: 'Configured model policy id for this delegation. Choose only from the advertised menu.',
        },
        reasoning_effort: {
          type: 'string',
          required: true,
          description: 'Exact effort id allowlisted for the selected model. This choice is required per call.',
        },
        ...backgroundEnabled ? {
          run_in_background: {
            type: 'boolean' as const,
            description: 'Run as a background job and return its id. Defaults to false.',
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
                selection: selectionSchema(),
              },
            },
            {
              type: 'object',
              additionalProperties: false,
              properties: {
                kind: { type: 'string', required: true, const: 'foreground' },
                runId: { type: 'string', required: true },
                selection: selectionSchema(),
                output: { type: 'array', required: true, items: { type: 'json' } },
              },
            },
          ],
        },
        render: (_args, value) => {
          const selected = value.selection
          const route = String(selected.id) + ' => ' + String(selected.provider) + '/' + String(selected.model)
            + ' @ ' + String(selected.reasoningEffort)
          if (value.kind === 'background') {
            return [{ type: 'text', text: 'started background subagent job ' + value.jobId + ' [' + route + ']' }]
          }
          const text = (value.output as { text?: string }[])
            .map(block => (typeof block?.text === 'string' ? block.text : JSON.stringify(block)))
            .join('')
          return [{ type: 'text', text: 'subagent [' + route + '] ' + String(value.runId) + '\n' + text }]
        },
      },
      isConcurrencySafe: () => true,
      async execute(args, exec) {
        const allowedArguments = new Set([
          'description',
          'prompt',
          'model',
          'reasoning_effort',
          ...(backgroundEnabled ? ['run_in_background'] : []),
        ])
        const unexpected = Object.keys(args).find(key => !allowedArguments.has(key))
        if (unexpected !== undefined) throw new Error('unexpected argument "' + unexpected + '"')
        const caller = exec.agent
        if (!caller) throw new Error('routed subagent requires a calling agent')

        const policySnapshot = policies
        const rootsSnapshot = roots
        const selectedGeneration = generation
        const trackedCaller = childPolicies.get(caller)
        const delegationDepth = caller.session.header.delegationDepth ?? 0
        const allowed = allowedModelPolicyIds(
          policySnapshot,
          rootsSnapshot,
          delegationDepth,
          trackedCaller === undefined
            ? undefined
            : { generation: trackedCaller.generation, policyId: trackedCaller.selection.id },
          selectedGeneration,
        )
        const requested = resolveModelSelection(
          policySnapshot,
          allowed,
          args.model,
          args.reasoning_effort,
        )
        const policy = policySnapshot[requested.id]
        if (policy === undefined) throw new Error('unknown model policy "' + requested.id + '"')

        // Adapter-authoritative exact-model validation happens before child creation.
        const validated = await validateExactModelSelection(
          ctx.llm,
          requested,
          policy.maxTokens,
          exec.signal,
        )
        if (generation !== selectedGeneration) {
          throw new Error('routed-subagent configuration changed while validating the model selection; retry the call')
        }
        const { selection, agentOptions } = validated
        const selectionToken = randomUUID()
        const request = {
          label: args.description,
          prompt: [{ type: 'text', text: args.prompt }] as ContentBlock[],
          parent: caller,
          agentOptions: { ...agentOptions, dshRoutedSubagentToken: selectionToken },
          maxDepth,
        }
        const track = async (run: SubagentRun): Promise<SubagentRun> => {
          if (run.localAgent === undefined) {
            await run.dispose()
            throw new Error('routed-subagent requires the local spawn provider; received a non-local run')
          }
          childPolicies.set(run.localAgent, { generation: selectedGeneration, selection })
          return run
        }
        const start = (signal: AbortSignal): Promise<SubagentRun> => startGate.run(caller, async () => {
          if (generation !== selectedGeneration) {
            throw new Error('routed-subagent configuration changed before child start')
          }
          const pending: PendingChild = {
            generation: selectedGeneration,
            selection,
            token: selectionToken,
          }
          pendingStarts.set(caller, pending)
          try {
            return await track(await ctx.subagents.start(providerName, { ...request, signal }))
          } finally {
            if (pendingStarts.get(caller) === pending) pendingStarts.delete(caller)
          }
        })

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
              return {
                cancel: (reason?: string) => {
                  controller.abort(reason ?? 'background routed subagent task killed')
                },
                done: settleBackgroundStart(start(controller.signal), controller.signal),
              }
            },
          })
          return { kind: 'background' as const, jobId: id, selection }
        }

        const run = await start(exec.signal)
        return settleForegroundRun(run, selection)
      },
    }))
    const mounted = 'routed-subagent: "' + toolName + '" mounted on local provider "' + provider.name
      + '" — root models: ' + roots.join(', ')
    if (ctx.logger?.info) ctx.logger.info(mounted)
    else console.log('[routed-subagent] ' + mounted)
    return dispose
  }

  const mount = (provider: SubagentProvider): void => {
    mountedProvider = provider
    if (settings === undefined) {
      ctx.logger?.info('routed-subagent: no model policies configured; configure Settings → Plugins → Routed subagent to enable delegation')
      return
    }
    const dispose = registerTool(provider, settings)
    disposeTool = dispose
  }

  ctx.on('subagent/provider-added', (provider) => {
    if (provider.name === providerName && disposeTool === undefined) mount(provider)
  })
  ctx.on('subagent/provider-removed', (removed) => {
    if (removed !== providerName) return
    disposeTool?.()
    disposeTool = undefined
    mountedProvider = undefined
  })
  const present = ctx.subagents.getProvider(providerName)
  if (present !== undefined) {
    mount(present)
  } else {
    ctx.logger?.info(
      'routed-subagent: local provider "' + providerName + '" not registered yet; the "'
      + (settings?.toolName ?? 'routed_subagent') + '" tool will register when it appears',
    )
  }
}
