import { describe, expect, it, vi } from 'vitest'

import {
  catalogModel,
  loadModelCatalog,
  modelDefaults,
  providerDefaults,
  providerGroup,
  type ModelCatalogApi,
  type ModelCatalogValue,
} from '../src/client/model-catalog.js'

const catalog: ModelCatalogValue = {
  groups: [{
    id: 'codex',
    name: 'OpenAI Codex',
    models: [
      { id: 'mini', name: 'Mini' },
      {
        id: 'sol',
        name: 'Sol',
        description: 'Deep reasoning',
        reasoning: {
          defaultEffort: 'high',
          efforts: [
            { id: 'low', name: 'Low' },
            { id: 'high', name: 'High' },
          ],
        },
      },
    ],
  }],
  failures: [],
}

describe('model catalog selectors', () => {
  it('loads the session-independent LLM catalog', async () => {
    const models = vi.fn(async () => ({ result: { ok: true as const, value: catalog } }))
    const api = { llm: { models } } satisfies ModelCatalogApi

    await expect(loadModelCatalog(api)).resolves.toBe(catalog)
    expect(models).toHaveBeenCalledWith({})
  })

  it('surfaces catalog RPC failures', async () => {
    const api = {
      llm: { models: vi.fn(async () => ({ result: { ok: false as const, error: { code: 'offline', message: 'not connected' } } })) },
    } satisfies ModelCatalogApi

    await expect(loadModelCatalog(api)).rejects.toThrow('offline: not connected')
  })

  it('finds provider and exact-model metadata', () => {
    expect(providerGroup(catalog.groups, 'codex')?.name).toBe('OpenAI Codex')
    expect(catalogModel(catalog.groups, 'codex', 'sol')?.reasoning?.efforts).toHaveLength(2)
    expect(catalogModel(catalog.groups, 'missing', 'sol')).toBeUndefined()
  })

  it('adopts the first provider model and exact-model default effort', () => {
    expect(providerDefaults(catalog.groups, 'codex')).toEqual({
      provider: 'codex',
      model: 'mini',
      reasoningEffort: '',
    })
    expect(modelDefaults(catalog.groups, 'codex', 'sol')).toEqual({
      model: 'sol',
      reasoningEffort: 'high',
    })
  })
})
