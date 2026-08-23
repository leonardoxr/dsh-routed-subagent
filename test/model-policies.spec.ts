import { describe, expect, it } from 'vitest'
import {
  allowedModelPolicyIds,
  childModelPolicyIds,
  parseModelPolicyTable,
  resolveModelSelection,
  rootModelPolicyIds,
} from '../src/model-policies.ts'

const policies = parseModelPolicyTable({
  mini: {
    provider: 'openai-codex',
    model: 'gpt-5.4-mini',
    reasoningEfforts: ['low', 'medium'],
  },
  sol: {
    provider: 'openai-codex',
    model: 'gpt-5.6-sol',
    reasoningEfforts: ['medium', 'high', 'xhigh'],
    spawnableModels: ['mini'],
  },
})

describe('parseModelPolicyTable', () => {
  it('accepts a configured model and reasoning allowlist', () => {
    expect(policies.sol).toMatchObject({
      provider: 'openai-codex',
      model: 'gpt-5.6-sol',
      reasoningEfforts: ['medium', 'high', 'xhigh'],
      spawnableModels: ['mini'],
    })
  })

  it('rejects absent, malformed, duplicate, and legacy configuration', () => {
    expect(() => parseModelPolicyTable(undefined)).toThrow(/models.*non-empty mapping/)
    expect(() => parseModelPolicyTable({})).toThrow(/models.*non-empty mapping/)
    expect(() => parseModelPolicyTable({ x: { provider: 'p', reasoningEfforts: ['high'] } })).toThrow(/"x".*model/)
    expect(() => parseModelPolicyTable({ x: { provider: 'p', model: 'm', reasoningEfforts: [] } })).toThrow(/reasoningEfforts.*non-empty/)
    expect(() => parseModelPolicyTable({ x: { provider: 'p', model: 'm', reasoningEfforts: ['high', 'high'] } }))
      .toThrow(/reasoningEfforts.*duplicates/)
    expect(() => parseModelPolicyTable({ x: { provider: 'p', model: 'm', reasoningEfforts: ['high'], reasoningEffort: 'high' } }))
      .toThrow(/unknown field "reasoningEffort"/)
    expect(() => parseModelPolicyTable({ x: { provider: ' p', model: 'm', reasoningEfforts: ['high'] } }))
      .toThrow(/provider route.*surrounding whitespace/)
    expect(() => parseModelPolicyTable({ x: { provider: 'p', model: 'm\nbreak', reasoningEfforts: ['high'] } }))
      .toThrow(/model id.*control characters/)
    expect(() => parseModelPolicyTable({ x: { provider: 'p', model: 'm', reasoningEfforts: ['high'], description: 'bad\nline' } }))
      .toThrow(/description.*one trimmed line/)
  })

  it('rejects unsafe ids and unknown recursive model references', () => {
    const unsafe = Object.create(null) as Record<string, unknown>
    unsafe.__proto__ = { provider: 'p', model: 'm', reasoningEfforts: ['high'] }
    expect(() => parseModelPolicyTable(unsafe)).toThrow(/forbidden model policy id/)
    expect(() => parseModelPolicyTable({
      a: { provider: 'p', model: 'm', reasoningEfforts: ['high'], spawnableModels: ['ghost'] },
    })).toThrow(/"a" spawns unknown model policy "ghost"/)
  })
})

describe('model policy availability', () => {
  const roots = rootModelPolicyIds(policies, ['mini', 'sol'])

  it('requires explicit non-empty roots', () => {
    expect(roots).toEqual(['mini', 'sol'])
    expect(() => rootModelPolicyIds(policies, undefined)).toThrow(/rootModels.*non-empty/)
    expect(() => rootModelPolicyIds(policies, [])).toThrow(/rootModels.*non-empty/)
    expect(() => rootModelPolicyIds(policies, ['missing'])).toThrow(/unknown model policy "missing"/)
  })

  it('uses spawnable models for a tracked child', () => {
    expect(childModelPolicyIds(policies, 'sol')).toEqual(['mini'])
    expect(childModelPolicyIds(policies, 'mini')).toEqual([])
  })

  it('fails closed for untracked children and stale configuration generations', () => {
    expect(allowedModelPolicyIds(policies, roots, 0, undefined, 2)).toEqual(['mini', 'sol'])
    expect(allowedModelPolicyIds(policies, roots, 1, undefined, 2)).toEqual([])
    expect(allowedModelPolicyIds(policies, roots, 1, { generation: 1, policyId: 'sol' }, 2)).toEqual([])
    expect(allowedModelPolicyIds(policies, roots, 1, { generation: 2, policyId: 'sol' }, 2)).toEqual(['mini'])
  })
})

describe('resolveModelSelection', () => {
  const roots = rootModelPolicyIds(policies, ['mini', 'sol'])

  it('lets each call choose model and reasoning effort independently', () => {
    expect(resolveModelSelection(policies, roots, 'sol', 'xhigh')).toEqual({
      id: 'sol',
      provider: 'openai-codex',
      model: 'gpt-5.6-sol',
      reasoningEffort: 'xhigh',
    })
    expect(resolveModelSelection(policies, roots, 'sol', 'medium').reasoningEffort).toBe('medium')
  })

  it('rejects unavailable models and cross-model effort leakage', () => {
    expect(() => resolveModelSelection(policies, ['mini'], 'sol', 'high')).toThrow(/model "sol".*allowed here: mini/)
    expect(() => resolveModelSelection(policies, roots, 'mini', 'xhigh')).toThrow(/reasoning_effort "xhigh".*low, medium/)
  })
})
