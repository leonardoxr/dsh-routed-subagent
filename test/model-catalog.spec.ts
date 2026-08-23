import { describe, expect, it, vi } from 'vitest'

import {
  catalogModel,
  loadModelCatalog,
  modelChoice,
  modelDefaults,
  providerChoice,
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

  it('keeps custom provider and model ids editable without a catalog', () => {
    expect(providerChoice([], 'private-provider')).toEqual({
      provider: 'private-provider',
      model: '',
      reasoningEfforts: [],
    })
    expect(modelChoice([], 'private-provider', 'private/model-v2')).toEqual({
      model: 'private/model-v2',
      reasoningEfforts: [],
    })
  })

  it('adopts the first provider model and all exact-model reasoning efforts', () => {
    expect(providerDefaults(catalog.groups, 'codex')).toEqual({
      provider: 'codex',
      model: 'mini',
      reasoningEfforts: [],
    })
    expect(modelDefaults(catalog.groups, 'codex', 'sol')).toEqual({
      model: 'sol',
      reasoningEfforts: ['low', 'high'],
    })
  })
})
