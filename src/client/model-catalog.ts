/** Session-independent model catalog used by the tier editor. */
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

/** Selection adopted when a provider changes: its first advertised model and exact-model default effort. */
export function providerDefaults(
  groups: readonly CatalogProviderGroup[],
  provider: string,
): { provider: string; model: string; reasoningEffort: string } {
  const model = providerGroup(groups, provider)?.models[0]
  return {
    provider,
    model: model?.id ?? '',
    reasoningEffort: model?.reasoning?.defaultEffort ?? '',
  }
}

/** Exact-model default adopted when the model changes, mirroring the chat picker. */
export function modelDefaults(
  groups: readonly CatalogProviderGroup[],
  provider: string,
  model: string,
): { model: string; reasoningEffort: string } {
  return {
    model,
    reasoningEffort: catalogModel(groups, provider, model)?.reasoning?.defaultEffort ?? '',
  }
}
