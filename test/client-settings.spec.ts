import { describe, expect, it, vi } from 'vitest'

import { resetTierDraft, saveTierDraft, tierDraft } from '../src/client/index.js'

function scope(value: unknown = { tiers: { fast: { provider: 'openai-codex', model: 'gpt-5.6-luna' } } }) {
  return {
    getSnapshot: () => ({ value }),
    set: vi.fn(async () => undefined),
    unset: vi.fn(async () => undefined),
  }
}

describe('client settings-scope integration', () => {
  it('reads through getSnapshot and writes only the tiers field', async () => {
    const bound = scope()
    expect(JSON.parse(tierDraft(bound))).toHaveProperty('tiers.fast.model', 'gpt-5.6-luna')

    const tiers = { deep: { provider: 'openai-codex', model: 'gpt-5.6-sol' } }
    await expect(saveTierDraft(bound, JSON.stringify({ tiers }))).resolves.toBe(true)
    expect(bound.set).toHaveBeenCalledWith('tiers', tiers)
  })

  it('rejects malformed editor documents without writing', async () => {
    const bound = scope()
    await expect(saveTierDraft(bound, '{')).resolves.toBe(false)
    await expect(saveTierDraft(bound, JSON.stringify({ wrong: {} }))).resolves.toBe(false)
    expect(bound.set).not.toHaveBeenCalled()
  })

  it('resets the override through unset', async () => {
    const bound = scope()
    await resetTierDraft(bound)
    expect(bound.unset).toHaveBeenCalledWith('tiers')
  })
})
