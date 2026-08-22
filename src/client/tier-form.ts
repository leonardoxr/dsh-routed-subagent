/** Structured, UI-facing tier drafts and validation. */

export interface BoundTierScope {
  getSnapshot(): {
    value: { tiers?: unknown } | undefined
    writable?: boolean
  }
  set(field: string, value: unknown): Promise<void>
  unset(field: string): Promise<void>
}

export interface TierRow {
  id: string
  name: string
  provider: string
  model: string
  maxTokens: string
  reasoningEffort: string
  persona: string
  guidance: string
  spawnableIds: string[]
  /** Properties owned by a newer plugin version; round-tripped untouched. */
  extras: Record<string, unknown>
}

export type TierField = 'name' | 'provider' | 'model' | 'maxTokens' | 'spawnableIds'
export type TierError =
  | 'nameRequired'
  | 'nameDuplicate'
  | 'providerRequired'
  | 'modelRequired'
  | 'maxTokensInvalid'
  | 'spawnableInvalid'

export interface TierDefinitionDraft {
  provider: string
  model: string
  maxTokens?: number
  reasoningEffort?: string
  persona?: string
  guidance?: string
  spawnable?: string[]
}

export interface TierValidation {
  errors: Record<string, Partial<Record<TierField, TierError>>>
  formError?: 'tierRequired'
  tiers?: Record<string, TierDefinitionDraft>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

/** Project the resolved settings value into rows with stable in-draft identities. */
export function tierRows(value: { tiers?: unknown } | undefined): TierRow[] {
  if (!isRecord(value?.tiers)) return []
  const entries = Object.entries(value.tiers)
  const ids = new Map(entries.map(([name], index) => [name, `loaded-${index}`]))
  return entries.map(([name, raw], index) => {
    const tier = isRecord(raw) ? raw : {}
    const known = new Set(['provider', 'model', 'maxTokens', 'reasoningEffort', 'persona', 'guidance', 'spawnable'])
    const extras = Object.fromEntries(Object.entries(tier).filter(([key]) => !known.has(key)))
    return {
      id: `loaded-${index}`,
      name,
      provider: text(tier.provider),
      model: text(tier.model),
      maxTokens: typeof tier.maxTokens === 'number' ? String(tier.maxTokens) : '',
      reasoningEffort: text(tier.reasoningEffort),
      persona: text(tier.persona),
      guidance: text(tier.guidance),
      spawnableIds: Array.isArray(tier.spawnable)
        ? tier.spawnable.flatMap((entry) => typeof entry === 'string' && ids.has(entry) ? [ids.get(entry)!] : [])
        : [],
      extras,
    }
  })
}

/** Create one blank row for the add-tier action. */
export function blankTierRow(id: string): TierRow {
  return {
    id,
    name: '',
    provider: '',
    model: '',
    maxTokens: '',
    reasoningEffort: '',
    persona: '',
    guidance: '',
    spawnableIds: [],
    extras: {},
  }
}

/** Stable comparison key for staged-edit detection. */
export function tierRowsKey(rows: readonly TierRow[]): string {
  return JSON.stringify(rows)
}

/** Validate rows and, when valid, materialize the exact settings mapping to save. */
export function validateTierRows(rows: readonly TierRow[]): TierValidation {
  if (rows.length === 0) return { errors: {}, formError: 'tierRequired' }

  const errors: TierValidation['errors'] = {}
  const names = new Map<string, string[]>()
  const rowIds = new Set(rows.map(row => row.id))
  const setError = (row: TierRow, field: TierField, error: TierError): void => {
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
    if (row.spawnableIds.some(id => !rowIds.has(id))) setError(row, 'spawnableIds', 'spawnableInvalid')
  }
  for (const ids of names.values()) {
    if (ids.length < 2) continue
    for (const id of ids) {
      const row = rows.find(candidate => candidate.id === id)
      if (row !== undefined) setError(row, 'name', 'nameDuplicate')
    }
  }
  if (Object.keys(errors).length > 0) return { errors }

  const nameById = new Map(rows.map(row => [row.id, row.name.trim()]))
  const tiers: Record<string, TierDefinitionDraft> = {}
  for (const row of rows) {
    const maxTokens = row.maxTokens.trim()
    const reasoningEffort = row.reasoningEffort.trim()
    const persona = row.persona.trim()
    const guidance = row.guidance.trim()
    tiers[row.name.trim()] = {
      ...row.extras,
      provider: row.provider.trim(),
      model: row.model.trim(),
      ...(maxTokens === '' ? {} : { maxTokens: Number(maxTokens) }),
      ...(reasoningEffort === '' ? {} : { reasoningEffort }),
      ...(persona === '' ? {} : { persona }),
      ...(guidance === '' ? {} : { guidance }),
      ...(row.spawnableIds.length === 0
        ? {}
        : { spawnable: row.spawnableIds.map(id => nameById.get(id)!).filter(Boolean) }),
    }
  }
  return { errors, tiers }
}

/** Validate and persist the tier mapping through the public settings-scope API. */
export async function saveTierRows(scope: BoundTierScope, rows: readonly TierRow[]): Promise<TierValidation> {
  const result = validateTierRows(rows)
  if (result.tiers === undefined) return result
  await scope.set('tiers', result.tiers)
  return result
}

/** Clear the user override so the tier table inherits composition again. */
export async function resetTierRows(scope: BoundTierScope): Promise<void> {
  await scope.unset('tiers')
}
