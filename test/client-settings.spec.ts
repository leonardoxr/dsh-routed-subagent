import { describe, expect, it, vi } from 'vitest'

import {
  blankTierRow,
  resetTierRows,
  saveTierRows,
  tierRows,
  validateTierRows,
  type BoundTierScope,
} from '../src/client/tier-form.js'

function scope(value: unknown = { tiers: { fast: { provider: 'openai-codex', model: 'gpt-5.4-mini' } } }): BoundTierScope {
  return {
    getSnapshot: () => ({ value: value as { tiers?: unknown }, writable: true }),
    set: vi.fn(async () => undefined),
    unset: vi.fn(async () => undefined),
  }
}

describe('structured tier settings form', () => {
  it('decodes all fields and resolves spawnable names to stable row identities', () => {
    const rows = tierRows({ tiers: {
      fast: { provider: 'codex', model: 'mini', experimental: true },
      deep: {
        provider: 'codex',
        model: 'sol',
        maxTokens: 65536,
        reasoningEffort: 'high',
        persona: 'reviewer',
        guidance: 'Hard debugging.',
        spawnable: ['fast'],
      },
    } })

    expect(rows).toHaveLength(2)
    expect(rows[1]).toMatchObject({
      name: 'deep',
      maxTokens: '65536',
      reasoningEffort: 'high',
      persona: 'reviewer',
      guidance: 'Hard debugging.',
      spawnableIds: [rows[0]?.id],
    })
    expect(rows[0]?.extras).toEqual({ experimental: true })
  })

  it('encodes renamed tiers and preserves child links and unknown properties', () => {
    const rows = tierRows({ tiers: {
      fast: { provider: 'codex', model: 'mini', futureOption: { enabled: true } },
      deep: { provider: 'codex', model: 'sol', spawnable: ['fast'] },
    } })
    rows[0]!.name = 'quick'

    expect(validateTierRows(rows).tiers).toEqual({
      quick: { provider: 'codex', model: 'mini', futureOption: { enabled: true } },
      deep: { provider: 'codex', model: 'sol', spawnable: ['quick'] },
    })
  })

  it('reports required, duplicate, numeric, and dangling-reference errors', () => {
    const first = { ...blankTierRow('a'), name: 'same', provider: 'p', model: 'm', maxTokens: '1.5' }
    const second = { ...blankTierRow('b'), name: 'same', provider: '', model: '', spawnableIds: ['missing'] }
    const result = validateTierRows([first, second])

    expect(result.tiers).toBeUndefined()
    expect(result.errors.a).toMatchObject({ name: 'nameDuplicate', maxTokens: 'maxTokensInvalid' })
    expect(result.errors.b).toMatchObject({
      name: 'nameDuplicate',
      provider: 'providerRequired',
      model: 'modelRequired',
      spawnableIds: 'spawnableInvalid',
    })
    expect(validateTierRows([]).formError).toBe('tierRequired')
  })

  it('writes only a validated tiers mapping', async () => {
    const bound = scope()
    const rows = tierRows(bound.getSnapshot().value)
    await expect(saveTierRows(bound, rows)).resolves.toMatchObject({ tiers: expect.any(Object) })
    expect(bound.set).toHaveBeenCalledWith('tiers', {
      fast: { provider: 'openai-codex', model: 'gpt-5.4-mini' },
    })

    const invalid = [blankTierRow('new')]
    const refused = await saveTierRows(bound, invalid)
    expect(refused.tiers).toBeUndefined()
    expect(bound.set).toHaveBeenCalledOnce()
  })

  it('resets the override through unset', async () => {
    const bound = scope()
    await resetTierRows(bound)
    expect(bound.unset).toHaveBeenCalledWith('tiers')
  })
})
