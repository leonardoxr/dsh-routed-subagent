import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { LlmCallConfig } from '@deepseek-ai/dsh-llm'
import type { SubagentProvider, SubagentRun } from '@deepseek-ai/dsh-subagent'

const settingsHarness = vi.hoisted(() => ({ options: undefined as any, fallback: undefined as any, current: undefined as any }))
vi.mock('@deepseek-ai/dsh-settings', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@deepseek-ai/dsh-settings')>()
  return {
    ...actual,
    installSettingsSection: vi.fn((_ctx, _namespace, _schema, fallback, options) => {
      settingsHarness.options = options
      settingsHarness.fallback = fallback
      settingsHarness.current = fallback
      options.setSource(() => settingsHarness.current)
      options.onChange()
    }),
  }
})

import { apply, type Config } from '../src/index.ts'

function agent(id: string, depth = 0, parentSession?: string): Agent {
  return {
    id,
    options: {},
    session: {
      header: { id, delegationDepth: depth, ...(parentSession === undefined ? {} : { parentSession }) },
    },
  } as unknown as Agent
}

interface Harness {
  ctx: Context
  root: Agent
  child: Agent
  unrelatedChild: Agent
  tool: any
  requestConfig: LlmCallConfig | undefined
  unrelatedRequestConfig: LlmCallConfig | undefined
  resolveCallConfig: ReturnType<typeof vi.fn>
  start: ReturnType<typeof vi.fn>
  registerTool: ReturnType<typeof vi.fn>
  disposeRun: ReturnType<typeof vi.fn>
}

function harness(): Harness {
  const handlers = new Map<string, Function[]>()
  const root = agent('root', 0)
  const child = agent('child', 1, 'root')
  const unrelatedChild = agent('unrelated-child', 1, 'root')
  let tool: any
  let requestConfig: LlmCallConfig | undefined
  let unrelatedRequestConfig: LlmCallConfig | undefined
  const disposeRun = vi.fn()
  const run = {
    id: 'run-1',
    localAgent: child,
    result: Promise.resolve({ stopReason: 'completed', output: [{ type: 'text', text: 'done' }] }),
    dispose: disposeRun,
  } as unknown as SubagentRun
  const resolveCallConfig = vi.fn(async (config: LlmCallConfig) => config)
  let ctx!: Context
  const start = vi.fn(async (_provider: string, request: { agentOptions: Record<string, unknown> }) => {
    const waterfall = handlers.get('agent/request')?.[0]
    const created = handlers.get('agent/created')?.[0]
    if (waterfall === undefined || created === undefined) throw new Error('agent lifecycle handlers missing')
    // An unrelated same-parent child requests during routed publication. Parent
    // ownership alone must not associate it with this selection.
    unrelatedRequestConfig = await waterfall(
      { agent: unrelatedChild },
      async () => ({ provider: 'inherited', model: 'inherited' } satisfies LlmCallConfig),
    )
    ;(child as unknown as { options: Record<string, unknown> }).options = request.agentOptions
    created({ agent: child })
    requestConfig = await waterfall(
      { agent: child },
      async () => ({ provider: 'inherited', model: 'inherited' } satisfies LlmCallConfig),
    )
    return run
  })
  const registerTool = vi.fn((value: any) => {
    if (value.name === 'existing_tool') throw new Error('tool already registered')
    tool = value
    return vi.fn(() => { if (tool === value) tool = undefined })
  })
  const provider = {
    name: 'spawn',
    capabilities: { outputSchema: true, depthLimit: true, toolFilter: true, persona: true },
  } as unknown as SubagentProvider
  const agents = new Map([['root', root], ['child', child], ['unrelated-child', unrelatedChild]])
  ctx = {
    on: vi.fn((event: string, handler: Function) => {
      handlers.set(event, [...handlers.get(event) ?? [], handler])
      return vi.fn()
    }),
    tools: {
      register: registerTool,
      get: vi.fn((name: string) => name === 'existing_tool' ? { name } : tool?.name === name ? tool : undefined),
    },
    subagents: { getProvider: vi.fn(() => provider), start },
    llm: { resolveCallConfig },
    agents: {
      get: vi.fn((id: string) => agents.get(id)),
      isOwnedBy: vi.fn((id: string, parent: Agent) => (id === 'child' || id === 'unrelated-child') && parent === root),
    },
    get: vi.fn(() => undefined),
    logger: { info: vi.fn() },
  } as unknown as Context

  apply(ctx, {
    rootModels: ['sol'],
    maxDepth: 1,
    models: {
      sol: {
        provider: 'openai-codex',
        model: 'gpt-5.6-sol',
        reasoningEfforts: ['medium', 'high'],
        maxTokens: 32768,
      },
    },
  } satisfies Config)
  return {
    ctx,
    root,
    child,
    unrelatedChild,
    get tool() { return tool },
    get requestConfig() { return requestConfig },
    get unrelatedRequestConfig() { return unrelatedRequestConfig },
    resolveCallConfig,
    start,
    registerTool,
    disposeRun,
  } as Harness
}

describe('mounted routed subagent tool', () => {
  beforeEach(() => {
    settingsHarness.options = undefined
    settingsHarness.fallback = undefined
    settingsHarness.current = undefined
  })

  it('requires model and effort and pins the first request before start fulfills', async () => {
    const app = harness()
    expect(app.tool.parameters.required).toEqual(expect.arrayContaining(['model', 'reasoning_effort']))
    await expect(app.tool.execute({
      description: 'invalid shape',
      prompt: 'Do work.',
      model: 'sol',
      reasoning_effort: 'high',
      unexpected: true,
    }, { agent: app.root, signal: new AbortController().signal })).rejects.toThrow(/unexpected/)

    await expect(app.tool.execute({
      description: 'deep review',
      prompt: 'Review the architecture.',
      model: 'sol',
      reasoning_effort: 'high',
    }, { agent: app.root, signal: new AbortController().signal })).resolves.toMatchObject({
      kind: 'foreground',
      selection: {
        id: 'sol',
        provider: 'openai-codex',
        model: 'gpt-5.6-sol',
        reasoningEffort: 'high',
      },
    })

    expect(app.requestConfig).toMatchObject({
      provider: 'openai-codex',
      model: 'gpt-5.6-sol',
      reasoningEffort: 'high',
    })
    expect(app.unrelatedRequestConfig).toEqual({ provider: 'inherited', model: 'inherited' })
    await expect(app.tool.execute({
      description: 'must stay denied',
      prompt: 'Do work.',
      model: 'sol',
      reasoning_effort: 'high',
    }, { agent: app.unrelatedChild, signal: new AbortController().signal })).rejects.toThrow(/allowed here: none/)
    expect(app.resolveCallConfig.mock.invocationCallOrder[0]).toBeLessThan(app.start.mock.invocationCallOrder[0]!)
    expect(app.disposeRun).toHaveBeenCalledOnce()
  })

  it('hot-remounts tool name, background mode, depth, and policy settings', async () => {
    const app = harness()
    const next = {
      ...settingsHarness.fallback,
      toolName: 'delegate_model',
      enableRunInBackground: false,
      maxDepth: 3,
    }
    settingsHarness.options.validate(next)
    settingsHarness.current = next
    settingsHarness.options.onChange()

    expect(app.tool.name).toBe('delegate_model')
    expect(app.tool.parameters.properties.run_in_background).toBeUndefined()
    await app.tool.execute({
      description: 'new settings',
      prompt: 'Use the remounted tool.',
      model: 'sol',
      reasoning_effort: 'high',
    }, { agent: app.root, signal: new AbortController().signal })
    expect(app.start.mock.calls[0]?.[1]).toMatchObject({ maxDepth: 3 })
  })

  it('keeps the previous tool mounted when a renamed tool collides', () => {
    const app = harness()
    const original = app.tool
    const collision = { ...settingsHarness.fallback, toolName: 'existing_tool' }
    expect(() => settingsHarness.options.validate(collision)).toThrow(/already registered/)
    expect(settingsHarness.current).toBe(settingsHarness.fallback)
    expect(app.tool).toBe(original)

    const available = { ...settingsHarness.fallback, toolName: 'available_tool' }
    expect(() => settingsHarness.options.validate(available)).not.toThrow()
    settingsHarness.current = available
    expect(() => settingsHarness.options.onChange()).not.toThrow()
    expect(app.tool.name).toBe('available_tool')
  })

  it('restores the old same-name tool when replacement registration fails', () => {
    const app = harness()
    const original = app.tool
    app.registerTool.mockImplementationOnce(() => { throw new Error('replacement failed') })
    const failed = { ...settingsHarness.fallback, maxDepth: 2 }
    settingsHarness.options.validate(failed)
    settingsHarness.current = failed
    expect(() => settingsHarness.options.onChange()).toThrow(/replacement failed/)
    expect(app.tool.name).toBe(original.name)

    const recovered = { ...settingsHarness.fallback, maxDepth: 3 }
    settingsHarness.options.validate(recovered)
    settingsHarness.current = recovered
    expect(() => settingsHarness.options.onChange()).not.toThrow()
    expect(app.tool.name).toBe('routed_subagent')
  })

  it('denies invalid authority and unsupported effort before spawning', async () => {
    const app = harness()
    await expect(app.tool.execute({
      description: 'bad effort',
      prompt: 'Do work.',
      model: 'sol',
      reasoning_effort: 'xhigh',
    }, { agent: app.root, signal: new AbortController().signal })).rejects.toThrow(/reasoning_effort.*not allowed/)
    expect(app.resolveCallConfig).not.toHaveBeenCalled()
    expect(app.start).not.toHaveBeenCalled()

    const untrackedChild = agent('foreign-child', 1, 'root')
    await expect(app.tool.execute({
      description: 'unauthorized',
      prompt: 'Do work.',
      model: 'sol',
      reasoning_effort: 'high',
    }, { agent: untrackedChild, signal: new AbortController().signal })).rejects.toThrow(/allowed here: none/)
    expect(app.resolveCallConfig).not.toHaveBeenCalled()
    expect(app.start).not.toHaveBeenCalled()
  })

  it('echoes the effective selection from a background launch', async () => {
    const app = harness()
    const startJob = vi.fn(() => 'job-1')
    vi.mocked(app.ctx.get).mockReturnValue({ start: startJob } as never)
    await expect(app.tool.execute({
      description: 'background review',
      prompt: 'Review later.',
      model: 'sol',
      reasoning_effort: 'medium',
      run_in_background: true,
    }, { agent: app.root, signal: new AbortController().signal })).resolves.toMatchObject({
      kind: 'background',
      jobId: 'job-1',
      selection: { id: 'sol', model: 'gpt-5.6-sol', reasoningEffort: 'medium' },
    })
    expect(startJob).toHaveBeenCalledOnce()
    expect(app.start).not.toHaveBeenCalled()
  })

  it('disposes and refuses a run without a local agent', async () => {
    const app = harness()
    const dispose = vi.fn()
    app.start.mockResolvedValueOnce({
      id: 'remote-run',
      localAgent: undefined,
      result: new Promise(() => undefined),
      dispose,
    } as unknown as SubagentRun)
    await expect(app.tool.execute({
      description: 'remote refusal',
      prompt: 'Do work.',
      model: 'sol',
      reasoning_effort: 'high',
    }, { agent: app.root, signal: new AbortController().signal })).rejects.toThrow(/requires the local spawn provider/)
    expect(dispose).toHaveBeenCalledOnce()
  })

  it('does not spawn when the adapter rejects an allowed configured effort', async () => {
    const app = harness()
    app.resolveCallConfig.mockRejectedValueOnce(new Error('adapter model metadata is stale'))
    await expect(app.tool.execute({
      description: 'stale route',
      prompt: 'Do work.',
      model: 'sol',
      reasoning_effort: 'high',
    }, { agent: app.root, signal: new AbortController().signal })).rejects.toThrow(/metadata is stale/)
    expect(app.start).not.toHaveBeenCalled()
  })
})
