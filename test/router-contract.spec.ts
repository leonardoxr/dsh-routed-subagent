import { describe, expect, it, vi } from 'vitest'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { ReasoningEffortId, type LlmCallConfig } from '@deepseek-ai/dsh-llm'
import { resolveChildAgentOptions } from '@deepseek-ai/dsh-subagent'
import {
  PerAgentStartGate,
  pinModelSelection,
  resolveMaxDepth,
  resolveRuntimeRouterSettings,
  resolveToolName,
  toolDescription,
  validateExactModelSelection,
  type CallConfigResolver,
  type EffectiveSelection,
} from '../src/index.ts'
import { parseModelPolicyTable } from '../src/model-policies.ts'

const selection: EffectiveSelection = {
  id: 'sol',
  provider: 'openai-codex',
  model: 'gpt-5.6-sol',
  reasoningEffort: 'high',
}

describe('adapter-authoritative routing', () => {
  it('validates the exact model/effort before deriving agent options', async () => {
    const signal = new AbortController().signal
    const resolveCallConfig = vi.fn(async (config: LlmCallConfig) => ({ ...config, maxTokens: 32768 }))
    const resolver = { resolveCallConfig } satisfies CallConfigResolver

    await expect(validateExactModelSelection(resolver, selection, 32768, signal)).resolves.toEqual({
      selection,
      agentOptions: { provider: 'openai-codex', model: 'gpt-5.6-sol', maxTokens: 32768 },
    })
    expect(resolveCallConfig).toHaveBeenCalledWith({
      provider: 'openai-codex',
      model: 'gpt-5.6-sol',
      reasoningEffort: ReasoningEffortId('high'),
      maxTokens: 32768,
    }, signal)
  })

  it('propagates unsupported combinations and rejects adapter substitution', async () => {
    const unsupported: CallConfigResolver = {
      resolveCallConfig: vi.fn(async () => { throw new Error('unsupported reasoning effort') }),
    }
    await expect(validateExactModelSelection(unsupported, selection, undefined)).rejects.toThrow(/unsupported/)

    const substituted: CallConfigResolver = {
      resolveCallConfig: vi.fn(async () => ({
        provider: selection.provider,
        model: selection.model,
        reasoningEffort: ReasoningEffortId('medium'),
      })),
    }
    await expect(validateExactModelSelection(substituted, selection, undefined)).rejects.toThrow(/different explicit/)
  })
})

describe('provider publication gate', () => {
  it('preserves the exact routed token through public child option resolution', () => {
    const parent = { options: { provider: 'parent', model: 'parent-model' } } as Agent
    expect(resolveChildAgentOptions(parent, {
      provider: 'child',
      model: 'child-model',
      dshRoutedSubagentToken: 'exact-token',
    }, 1)).toMatchObject({
      provider: 'child',
      model: 'child-model',
      dshRoutedSubagentToken: 'exact-token',
    })
  })

  it('serializes starts from one parent but not their child lifetimes', async () => {
    const gate = new PerAgentStartGate()
    const parent = {}
    const events: string[] = []
    let releaseFirst!: () => void
    const firstBlocked = new Promise<void>((resolve) => { releaseFirst = resolve })
    const first = gate.run(parent, async () => {
      events.push('first-start')
      await firstBlocked
      events.push('first-published')
      return 'first-run'
    })
    const second = gate.run(parent, async () => {
      events.push('second-start')
      return 'second-run'
    })
    await Promise.resolve()
    expect(events).toEqual(['first-start'])
    releaseFirst()
    await expect(Promise.all([first, second])).resolves.toEqual(['first-run', 'second-run'])
    expect(events).toEqual(['first-start', 'first-published', 'second-start'])
  })
})

describe('immutable per-child request routing', () => {
  const base: LlmCallConfig = { provider: 'other', model: 'other', maxTokens: 4096 }

  it('keeps concurrent effort choices isolated', () => {
    const high = pinModelSelection(base, selection)
    const low = pinModelSelection(base, { ...selection, reasoningEffort: 'low' })

    expect(high).toMatchObject({ provider: selection.provider, model: selection.model, reasoningEffort: 'high' })
    expect(low).toMatchObject({ provider: selection.provider, model: selection.model, reasoningEffort: 'low' })
    expect(base).toEqual({ provider: 'other', model: 'other', maxTokens: 4096 })
  })

  it('reuses an already exact call config', () => {
    const exact = pinModelSelection(base, selection)
    expect(pinModelSelection(exact, selection)).toBe(exact)
  })
})

describe('router contract metadata', () => {
  it('requires a positive finite depth cap', () => {
    expect(resolveMaxDepth(undefined)).toBe(1)
    expect(resolveMaxDepth(3)).toBe(3)
    expect(() => resolveMaxDepth('provider-managed')).toThrow(/positive safe integer/)
    expect(() => resolveMaxDepth(0)).toThrow(/positive safe integer/)
  })

  it('validates every hot-editable general setting', () => {
    expect(resolveToolName(undefined)).toBe('routed_subagent')
    expect(() => resolveToolName(' delegate')).toThrow(/toolName/)
    expect(resolveRuntimeRouterSettings({
      toolName: 'delegate',
      enableRunInBackground: false,
      maxDepth: 3,
      rootModels: ['sol'],
      models: {
        sol: { provider: 'codex', model: 'sol', reasoningEfforts: ['high'] },
      },
    })).toMatchObject({
      toolName: 'delegate',
      enableRunInBackground: false,
      maxDepth: 3,
      roots: ['sol'],
    })
  })

  it('advertises selectable model and effort ids', () => {
    const policies = parseModelPolicyTable({
      sol: {
        provider: 'openai-codex',
        model: 'gpt-5.6-sol',
        reasoningEfforts: ['medium', 'high'],
        description: 'Hard debugging.',
      },
    })
    expect(toolDescription(policies, ['sol'])).toContain('"sol": openai-codex/gpt-5.6-sol')
    expect(toolDescription(policies, ['sol'])).toContain('reasoning_effort: [medium, high]')
  })
})
