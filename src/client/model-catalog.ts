/** Session-independent model catalog used by the model policy editor. */
export interface CatalogReasoningEffort {
  id: string
  name: string
  description?: string
}

export interface CatalogReasoning {
  efforts: CatalogReasoningEffort[]
  defaultEffort?: string
}

export interface CatalogModel {
  id: string
  name: string
  description?: string
  reasoning?: CatalogReasoning
}

export interface CatalogProviderGroup {
  id: string
  name: string
  models: CatalogModel[]
}

export interface CatalogFailure {
  id: string
  name: string
  message: string
}

export interface ModelCatalogValue {
  groups: CatalogProviderGroup[]
  failures: CatalogFailure[]
}

interface CatalogRpcError {
  code: string
  message: string
}

export interface ModelCatalogApi {
  llm: {
    models(request: Record<string, never>): Promise<{
      result:
        | { ok: true; value: ModelCatalogValue }
        | { ok: false; error: CatalogRpcError }
    }>
  }
}

/** Load the same host-scoped catalog that backs the chat model selector. */
export async function loadModelCatalog(api: ModelCatalogApi): Promise<ModelCatalogValue> {
  const { result } = await api.llm.models({})
  if (!result.ok) throw new Error(result.error.code + ': ' + result.error.message)
  return result.value
}

export function providerGroup(groups: readonly CatalogProviderGroup[], provider: string): CatalogProviderGroup | undefined {
  return groups.find(group => group.id === provider)
}

export function catalogModel(
  groups: readonly CatalogProviderGroup[],
  provider: string,
  model: string,
): CatalogModel | undefined {
  return providerGroup(groups, provider)?.models.find(candidate => candidate.id === model)
}

/** Selection adopted when a provider changes: first model and every advertised effort. */
export function providerDefaults(
  groups: readonly CatalogProviderGroup[],
  provider: string,
): { provider: string; model: string; reasoningEfforts: string[] } {
  const model = providerGroup(groups, provider)?.models[0]
  return {
    provider,
    model: model?.id ?? '',
    reasoningEfforts: model?.reasoning?.efforts.map(effort => effort.id) ?? [],
  }
}

/** Provider edit that remains usable when the catalog is absent or advisory. */
export function providerChoice(
  groups: readonly CatalogProviderGroup[],
  provider: string,
): { provider: string; model: string; reasoningEfforts: string[] } {
  return providerGroup(groups, provider) === undefined
    ? { provider, model: '', reasoningEfforts: [] }
    : providerDefaults(groups, provider)
}

/** Exact-model selection adopted when the model changes, allowing every advertised effort. */
export function modelDefaults(
  groups: readonly CatalogProviderGroup[],
  provider: string,
  model: string,
): { model: string; reasoningEfforts: string[] } {
  return {
    model,
    reasoningEfforts: catalogModel(groups, provider, model)?.reasoning?.efforts.map(effort => effort.id) ?? [],
  }
}

/** Model edit that accepts exact custom ids when no catalog entry exists. */
export function modelChoice(
  groups: readonly CatalogProviderGroup[],
  provider: string,
  model: string,
): { model: string; reasoningEfforts: string[] } {
  return catalogModel(groups, provider, model) === undefined
    ? { model, reasoningEfforts: [] }
    : modelDefaults(groups, provider, model)
}
