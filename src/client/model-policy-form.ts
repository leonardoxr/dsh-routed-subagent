/** Structured, UI-facing routed-subagent drafts and validation. */

export interface RoutedSettingsValue {
  toolName?: unknown
  enableRunInBackground?: unknown
  maxDepth?: unknown
  rootModels?: unknown
  models?: unknown
}

export interface BoundModelPolicyScope {
  getSnapshot(): {
    value: RoutedSettingsValue | undefined
    base?: unknown
    writable?: boolean
  }
  set(field: string, value: unknown): Promise<void>
  unset(field: string): Promise<void>
}

export interface RouterGeneralDraft {
  toolName: string
  maxDepth: string
  enableRunInBackground: boolean
}

export interface ModelPolicyRow {
  id: string
  name: string
  originalName: string
  root: boolean
  provider: string
  model: string
  maxTokens: string
  reasoningEfforts: string[]
  description: string
  spawnableIds: string[]
}

export type ModelPolicyField = 'name' | 'provider' | 'model' | 'maxTokens' | 'reasoningEfforts' | 'description' | 'spawnableIds'
export type ModelPolicyError =
  | 'nameRequired'
  | 'nameDuplicate'
  | 'providerRequired'
  | 'modelRequired'
  | 'maxTokensInvalid'
  | 'reasoningRequired'
  | 'descriptionInvalid'
  | 'spawnableInvalid'

export type GeneralSettingsField = 'toolName' | 'maxDepth'
export type GeneralSettingsError = 'toolNameRequired' | 'maxDepthInvalid'

export interface ModelPolicyDraft {
  provider: string
  model: string
  reasoningEfforts: string[]
  maxTokens?: number
  description?: string
  spawnableModels?: string[]
}

export interface ModelPolicyValidation {
  errors: Record<string, Partial<Record<ModelPolicyField, ModelPolicyError>>>
  formError?: 'modelPolicyRequired' | 'rootModelRequired'
  models?: Record<string, ModelPolicyDraft>
  rootModels?: string[]
}

export interface RoutedSettingsValidation extends ModelPolicyValidation {
  generalErrors: Partial<Record<GeneralSettingsField, GeneralSettingsError>>
  settings?: {
    toolName: string
    enableRunInBackground: boolean
    maxDepth: number
    rootModels: string[]
    models: Record<string, ModelPolicyDraft>
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : []
}

export function configuredRootModels(value: RoutedSettingsValue | undefined): string[] {
  return stringList(value?.rootModels)
}

export function routerGeneralDraft(value: RoutedSettingsValue | undefined): RouterGeneralDraft {
  return {
    toolName: typeof value?.toolName === 'string' ? value.toolName : 'routed_subagent',
    maxDepth: typeof value?.maxDepth === 'number' ? String(value.maxDepth) : '1',
    enableRunInBackground: value?.enableRunInBackground !== false,
  }
}

/** Project resolved settings into rows with stable in-draft identities. */
export function modelPolicyRows(value: RoutedSettingsValue | undefined): ModelPolicyRow[] {
  if (!isRecord(value?.models)) return []
  const entries = Object.entries(value.models)
  const roots = new Set(configuredRootModels(value))
  const ids = new Map(entries.map(([name], index) => [name, 'loaded-' + index]))
  return entries.map(([name, raw], index) => {
    const policy = isRecord(raw) ? raw : {}
    return {
      id: 'loaded-' + index,
      name,
      originalName: name,
      root: roots.has(name),
      provider: text(policy.provider),
      model: text(policy.model),
      maxTokens: typeof policy.maxTokens === 'number' ? String(policy.maxTokens) : '',
      reasoningEfforts: stringList(policy.reasoningEfforts),
      description: text(policy.description),
      spawnableIds: stringList(policy.spawnableModels)
        .flatMap(entry => ids.has(entry) ? [ids.get(entry)!] : []),
    }
  })
}

export function blankModelPolicyRow(id: string): ModelPolicyRow {
  return {
    id,
    name: '',
    originalName: '',
    root: false,
    provider: '',
    model: '',
    maxTokens: '',
    reasoningEfforts: [],
    description: '',
    spawnableIds: [],
  }
}

export function modelPolicyRowsKey(rows: readonly ModelPolicyRow[]): string {
  return JSON.stringify(rows)
}

/** Preserve empty trailing segments so controlled comma entry remains typeable. */
export function parseReasoningEffortDraft(value: string): string[] {
  return value.split(',').map(entry => entry.trim())
}

/** Validate rows and materialize the exact model and root settings to save. */
export function validateModelPolicyRows(rows: readonly ModelPolicyRow[]): ModelPolicyValidation {
  if (rows.length === 0) return { errors: {}, formError: 'modelPolicyRequired' }

  const errors: ModelPolicyValidation['errors'] = {}
  const names = new Map<string, string[]>()
  const rowIds = new Set(rows.map(row => row.id))
  const setError = (row: ModelPolicyRow, field: ModelPolicyField, error: ModelPolicyError): void => {
    errors[row.id] = { ...errors[row.id], [field]: error }
  }

  for (const row of rows) {
    const name = row.name.trim()
    if (name === '') setError(row, 'name', 'nameRequired')
    else names.set(name, [...names.get(name) ?? [], row.id])
    if (row.provider.trim() === '') setError(row, 'provider', 'providerRequired')
    if (row.model.trim() === '') setError(row, 'model', 'modelRequired')
    const maxTokens = row.maxTokens.trim()
    if (maxTokens !== '') {
      const parsed = Number(maxTokens)
      if (!Number.isSafeInteger(parsed) || parsed < 1) setError(row, 'maxTokens', 'maxTokensInvalid')
    }
    const efforts = row.reasoningEfforts.map(effort => effort.trim())
    if (efforts.length === 0 || efforts.some(effort => effort === '') || new Set(efforts).size !== efforts.length) {
      setError(row, 'reasoningEfforts', 'reasoningRequired')
    }
    const description = row.description.trim()
    if (description.length > 500 || /[\u0000-\u001f\u007f]/u.test(description)) {
      setError(row, 'description', 'descriptionInvalid')
    }
    if (row.spawnableIds.some(id => !rowIds.has(id))) setError(row, 'spawnableIds', 'spawnableInvalid')
  }

  for (const ids of names.values()) {
    if (ids.length < 2) continue
    for (const id of ids) {
      const row = rows.find(candidate => candidate.id === id)
      if (row !== undefined) setError(row, 'name', 'nameDuplicate')
    }
  }

  const rootRows = rows.filter(row => row.root)
  if (Object.keys(errors).length > 0 || rootRows.length === 0) {
    return { errors, ...(rootRows.length === 0 ? { formError: 'rootModelRequired' as const } : {}) }
  }

  const nameById = new Map(rows.map(row => [row.id, row.name.trim()]))
  const models: Record<string, ModelPolicyDraft> = {}
  for (const row of rows) {
    const maxTokens = row.maxTokens.trim()
    const description = row.description.trim()
    models[row.name.trim()] = {
      provider: row.provider.trim(),
      model: row.model.trim(),
      reasoningEfforts: row.reasoningEfforts.map(effort => effort.trim()),
      ...(maxTokens === '' ? {} : { maxTokens: Number(maxTokens) }),
      ...(description === '' ? {} : { description }),
      ...(row.spawnableIds.length === 0
        ? {}
        : { spawnableModels: row.spawnableIds.map(id => nameById.get(id)!).filter(Boolean) }),
    }
  }
  return { errors, models, rootModels: rootRows.map(row => row.name.trim()) }
}

export function validateRoutedSettings(rows: readonly ModelPolicyRow[], general: RouterGeneralDraft): RoutedSettingsValidation {
  const policy = validateModelPolicyRows(rows)
  const generalErrors: RoutedSettingsValidation['generalErrors'] = {}
  const toolName = general.toolName.trim()
  if (toolName === '' || /[\u0000-\u001f\u007f]/u.test(toolName)) generalErrors.toolName = 'toolNameRequired'
  const maxDepth = Number(general.maxDepth.trim())
  if (!Number.isSafeInteger(maxDepth) || maxDepth < 1) generalErrors.maxDepth = 'maxDepthInvalid'
  if (policy.models === undefined || policy.rootModels === undefined || Object.keys(generalErrors).length > 0) {
    return { ...policy, generalErrors }
  }
  return {
    ...policy,
    generalErrors,
    settings: {
      toolName,
      enableRunInBackground: general.enableRunInBackground,
      maxDepth,
      models: policy.models,
      rootModels: policy.rootModels,
    },
  }
}

function modelTable(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {}
}

/** Persist every router setting while keeping each intermediate section valid. */
export async function saveRoutedSettings(
  scope: BoundModelPolicyScope,
  rows: readonly ModelPolicyRow[],
  general: RouterGeneralDraft,
): Promise<RoutedSettingsValidation> {
  const result = validateRoutedSettings(rows, general)
  if (result.settings === undefined) return result

  const current = scope.getSnapshot().value
  // Keep the complete old graph alive until roots point at the complete new
  // graph. Carrying only old roots can leave their old child references dangling.
  const bridgeModels: Record<string, unknown> = {
    ...modelTable(current?.models),
    ...result.settings.models,
  }

  await scope.set('models', bridgeModels)
  await scope.set('rootModels', result.settings.rootModels)
  await scope.set('models', result.settings.models)
  await scope.set('toolName', result.settings.toolName)
  await scope.set('maxDepth', result.settings.maxDepth)
  await scope.set('enableRunInBackground', result.settings.enableRunInBackground)
  return result
}

/** Clear every override and safely restore the complete composition section. */
export async function resetRoutedSettings(scope: BoundModelPolicyScope): Promise<void> {
  const snapshot = scope.getSnapshot()
  if (!isRecord(snapshot.base)) throw new Error('composition settings are unavailable')
  const base = snapshot.base as RoutedSettingsValue
  const baseModels = modelTable(base.models)
  const currentModels = modelTable(snapshot.value?.models)
  const bridgeModels: Record<string, unknown> = { ...currentModels, ...baseModels }
  await scope.set('models', bridgeModels)
  await scope.set('rootModels', configuredRootModels(base))
  await scope.unset('models')
  await scope.unset('rootModels')
  await scope.unset('toolName')
  await scope.unset('maxDepth')
  await scope.unset('enableRunInBackground')
}
