import { describe, expect, it, vi } from 'vitest'
import {
  blankModelPolicyRow,
  modelPolicyRows,
  parseReasoningEffortDraft,
  resetRoutedSettings,
  routerGeneralDraft,
  saveRoutedSettings,
  validateModelPolicyRows,
  validateRoutedSettings,
  type BoundModelPolicyScope,
  type RoutedSettingsValue,
} from '../src/client/model-policy-form.js'

function scope(value: RoutedSettingsValue = {
  toolName: 'routed_subagent',
  enableRunInBackground: true,
  maxDepth: 1,
  rootModels: ['mini'],
  models: { mini: { provider: 'openai-codex', model: 'gpt-5.4-mini', reasoningEfforts: ['low', 'medium'] } },
}, base: RoutedSettingsValue = value): BoundModelPolicyScope {
  let current = { ...value }
  return {
    getSnapshot: () => ({ value: current, base, writable: true }),
    set: vi.fn(async (field: string, next: unknown) => { current = { ...current, [field]: next } }),
    unset: vi.fn(async (field: string) => {
      const next = { ...current }
      delete (next as Record<string, unknown>)[field]
      if (field in base) (next as Record<string, unknown>)[field] = base[field as keyof RoutedSettingsValue]
      current = next
    }),
  }
}

describe('structured routed settings form', () => {
  it('decodes general settings, effort allowlists, roots, and recursive names', () => {
    const value = {
      toolName: 'delegate',
      maxDepth: 3,
      enableRunInBackground: false,
      rootModels: ['sol'],
      models: {
        mini: { provider: 'codex', model: 'mini', reasoningEfforts: ['low', 'medium'] },
        sol: {
          provider: 'codex',
          model: 'sol',
          maxTokens: 65536,
          reasoningEfforts: ['medium', 'high'],
          description: 'Hard debugging.',
          spawnableModels: ['mini'],
        },
      },
    }
    const rows = modelPolicyRows(value)
    expect(routerGeneralDraft(value)).toEqual({ toolName: 'delegate', maxDepth: '3', enableRunInBackground: false })
    expect(rows).toHaveLength(2)
    expect(rows[1]).toMatchObject({
      name: 'sol',
      root: true,
      maxTokens: '65536',
      reasoningEfforts: ['medium', 'high'],
      description: 'Hard debugging.',
      spawnableIds: [rows[0]?.id],
    })
  })

  it('encodes renamed policies, editable roots, and child links', () => {
    const rows = modelPolicyRows({ models: {
      mini: { provider: 'codex', model: 'mini', reasoningEfforts: ['low'] },
      sol: { provider: 'codex', model: 'sol', reasoningEfforts: ['high'], spawnableModels: ['mini'] },
    } })
    rows[0]!.name = 'quick'
    rows[1]!.root = true

    expect(validateModelPolicyRows(rows)).toMatchObject({
      rootModels: ['sol'],
      models: {
        quick: { provider: 'codex', model: 'mini', reasoningEfforts: ['low'] },
        sol: { provider: 'codex', model: 'sol', reasoningEfforts: ['high'], spawnableModels: ['quick'] },
      },
    })
  })

  it('reports required, duplicate, numeric, effort, and dangling-reference errors', () => {
    const first = {
      ...blankModelPolicyRow('a'),
      name: 'same',
      provider: 'p',
      model: 'm',
      maxTokens: '1.5',
      reasoningEfforts: ['high', 'high'],
      root: true,
    }
    const second = { ...blankModelPolicyRow('b'), name: 'same', spawnableIds: ['missing'] }
    const result = validateModelPolicyRows([first, second])

    expect(result.models).toBeUndefined()
    expect(result.errors.a).toMatchObject({
      name: 'nameDuplicate',
      maxTokens: 'maxTokensInvalid',
      reasoningEfforts: 'reasoningRequired',
    })
    expect(result.errors.b).toMatchObject({
      name: 'nameDuplicate',
      provider: 'providerRequired',
      model: 'modelRequired',
      reasoningEfforts: 'reasoningRequired',
      spawnableIds: 'spawnableInvalid',
    })
    expect(validateModelPolicyRows([]).formError).toBe('modelPolicyRequired')
  })

  it('allows root membership and ids to be edited while requiring one root', () => {
    const rows = modelPolicyRows({
      rootModels: ['mini'],
      models: { mini: { provider: 'codex', model: 'mini', reasoningEfforts: ['low'] } },
    })
    rows[0]!.name = 'renamed'
    expect(validateModelPolicyRows(rows)).toMatchObject({ rootModels: ['renamed'] })
    rows[0]!.root = false
    expect(validateModelPolicyRows(rows).formError).toBe('rootModelRequired')
  })

  it('validates and writes every router setting with a safe root bridge', async () => {
    const bound = scope()
    const rows = modelPolicyRows(bound.getSnapshot().value)
    const general = { toolName: 'delegate', maxDepth: '2', enableRunInBackground: false }
    await expect(saveRoutedSettings(bound, rows, general)).resolves.toMatchObject({ settings: expect.any(Object) })
    expect(bound.set).toHaveBeenNthCalledWith(1, 'models', {
      mini: { provider: 'openai-codex', model: 'gpt-5.4-mini', reasoningEfforts: ['low', 'medium'] },
    })
    expect(bound.set).toHaveBeenNthCalledWith(2, 'rootModels', ['mini'])
    expect(bound.set).toHaveBeenNthCalledWith(3, 'models', expect.any(Object))
    expect(bound.set).toHaveBeenNthCalledWith(4, 'toolName', 'delegate')
    expect(bound.set).toHaveBeenNthCalledWith(5, 'maxDepth', 2)
    expect(bound.set).toHaveBeenNthCalledWith(6, 'enableRunInBackground', false)

    expect(validateRoutedSettings(rows, { ...general, maxDepth: '0' }).generalErrors.maxDepth).toBe('maxDepthInvalid')
    const invalid = [blankModelPolicyRow('new')]
    const refused = await saveRoutedSettings(bound, invalid, general)
    expect(refused.settings).toBeUndefined()
    expect(bound.set).toHaveBeenCalledTimes(6)
  })

  it('bridges simultaneous root and transitive child renames without dangling references', async () => {
    const bound = scope({
      toolName: 'routed_subagent',
      enableRunInBackground: true,
      maxDepth: 2,
      rootModels: ['old-root'],
      models: {
        'old-root': { provider: 'codex', model: 'sol', reasoningEfforts: ['high'], spawnableModels: ['old-child'] },
        'old-child': { provider: 'codex', model: 'mini', reasoningEfforts: ['low'] },
      },
    })
    const rows = modelPolicyRows(bound.getSnapshot().value)
    rows[0]!.name = 'new-root'
    rows[1]!.name = 'new-child'
    await saveRoutedSettings(bound, rows, routerGeneralDraft(bound.getSnapshot().value))
    expect(bound.set).toHaveBeenNthCalledWith(1, 'models', {
      'old-root': { provider: 'codex', model: 'sol', reasoningEfforts: ['high'], spawnableModels: ['old-child'] },
      'old-child': { provider: 'codex', model: 'mini', reasoningEfforts: ['low'] },
      'new-root': { provider: 'codex', model: 'sol', reasoningEfforts: ['high'], spawnableModels: ['new-child'] },
      'new-child': { provider: 'codex', model: 'mini', reasoningEfforts: ['low'] },
    })
    expect(bound.set).toHaveBeenNthCalledWith(2, 'rootModels', ['new-root'])
    expect(bound.set).toHaveBeenNthCalledWith(3, 'models', {
      'new-root': { provider: 'codex', model: 'sol', reasoningEfforts: ['high'], spawnableModels: ['new-child'] },
      'new-child': { provider: 'codex', model: 'mini', reasoningEfforts: ['low'] },
    })
  })

  it('preserves comma delimiters while custom efforts are typed character by character', () => {
    expect(parseReasoningEffortDraft('low,')).toEqual(['low', ''])
    expect(parseReasoningEffortDraft('low,').join(', ')).toBe('low, ')
    expect(parseReasoningEffortDraft('low, m')).toEqual(['low', 'm'])
    expect(parseReasoningEffortDraft('low, medium')).toEqual(['low', 'medium'])
  })

  it('accepts complete custom routes without model catalog metadata', () => {
    const row = {
      ...blankModelPolicyRow('custom'),
      name: 'private-model',
      root: true,
      provider: 'private-provider',
      model: 'private/model-v2',
      reasoningEfforts: ['careful', 'deep'],
    }
    expect(validateRoutedSettings([row], {
      toolName: 'delegate',
      maxDepth: '1',
      enableRunInBackground: true,
    })).toMatchObject({
      settings: {
        rootModels: ['private-model'],
        models: {
          'private-model': {
            provider: 'private-provider',
            model: 'private/model-v2',
            reasoningEfforts: ['careful', 'deep'],
          },
        },
      },
    })
  })

  it('resets every override through a valid composition bridge', async () => {
    const base: RoutedSettingsValue = {
      toolName: 'routed_subagent',
      enableRunInBackground: true,
      maxDepth: 1,
      rootModels: ['mini'],
      models: { mini: { provider: 'codex', model: 'mini', reasoningEfforts: ['low'] } },
    }
    const bound = scope({
      ...base,
      toolName: 'delegate',
      maxDepth: 3,
      rootModels: ['sol'],
      models: { sol: { provider: 'codex', model: 'sol', reasoningEfforts: ['high'] } },
    }, base)
    await resetRoutedSettings(bound)
    expect(bound.set).toHaveBeenNthCalledWith(1, 'models', {
      sol: { provider: 'codex', model: 'sol', reasoningEfforts: ['high'] },
      mini: { provider: 'codex', model: 'mini', reasoningEfforts: ['low'] },
    })
    expect(bound.set).toHaveBeenNthCalledWith(2, 'rootModels', ['mini'])
    expect(bound.unset).toHaveBeenCalledWith('models')
    expect(bound.unset).toHaveBeenCalledWith('rootModels')
    expect(bound.unset).toHaveBeenCalledWith('toolName')
    expect(bound.unset).toHaveBeenCalledWith('maxDepth')
    expect(bound.unset).toHaveBeenCalledWith('enableRunInBackground')
  })
})
