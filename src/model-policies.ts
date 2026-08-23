/**
 * Pure configured-model routing policy for the routed subagent tool.
 *
 * A tool call chooses one configured model policy and one of that policy's
 * explicit reasoning efforts. This module owns validation, recursion policy,
 * and fail-closed caller classification without Harness imports.
 * @module dsh-routed-subagent/model-policies
 */

/** One allowlisted model policy a delegated child may run on. */
export interface ModelPolicy {
  /** Registered LLM provider route. */
  provider: string
  /** Provider-owned model id. */
  model: string
  /** Non-empty allowlist of exact adapter-owned reasoning-effort ids. */
  reasoningEfforts: readonly string[]
  /** Optional per-request output-token cap for the child. */
  maxTokens?: number
  /** Concise tradeoff shown to the calling model. */
  description?: string
  /** Model-policy ids children on this model may delegate to. */
  spawnableModels?: readonly string[]
}

/** Validated model allowlist keyed by the short policy id exposed to the caller. */
export type ModelPolicyTable = Readonly<Record<string, ModelPolicy>>

/** Fully resolved per-call choice retained for the lifetime of one child. */
export interface ModelSelection {
  readonly id: string
  readonly provider: string
  readonly model: string
  readonly reasoningEffort: string
}

const POLICY_FIELDS = new Set([
  'provider',
  'model',
  'reasoningEfforts',
  'maxTokens',
  'description',
  'spawnableModels',
])
const FORBIDDEN_IDS = new Set(['__proto__', 'constructor', 'prototype'])

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value) as unknown
  return prototype === Object.prototype || prototype === null
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== ''
}

function validateId(value: string, label: string): void {
  if (value.trim() === '' || value !== value.trim()) {
    throw new Error('routed-subagent: ' + label + ' must be a non-empty string without surrounding whitespace')
  }
  if (value.length > 128) throw new Error('routed-subagent: ' + label + ' must be at most 128 characters')
  if (/[\u0000-\u001f\u007f]/u.test(value)) {
    throw new Error('routed-subagent: ' + label + ' must not contain control characters')
  }
  if (FORBIDDEN_IDS.has(value)) throw new Error('routed-subagent: forbidden ' + label + ' "' + value + '"')
}

function parseStringList(
  policyId: string,
  field: 'reasoningEfforts' | 'spawnableModels',
  value: unknown,
  required: boolean,
): readonly string[] {
  if (!Array.isArray(value) || (required && value.length === 0) || value.some(entry => !isNonEmptyString(entry))) {
    const amount = required ? 'non-empty ' : ''
    throw new Error(
      'routed-subagent: model policy "' + policyId + '" ' + field
      + ' must be a ' + amount + 'array of non-empty strings',
    )
  }
  const entries = value as string[]
  for (const entry of entries) validateId(entry, field + ' entry')
  if (new Set(entries).size !== entries.length) {
    throw new Error('routed-subagent: model policy "' + policyId + '" ' + field + ' must not contain duplicates')
  }
  return [...entries]
}

/** Validate the configured model allowlist and every recursive policy reference. */
export function parseModelPolicyTable(input: unknown): ModelPolicyTable {
  if (!isPlainObject(input) || Object.keys(input).length === 0) {
    throw new Error(
      'routed-subagent: models must be a non-empty mapping of policy id to '
      + '{ provider, model, reasoningEfforts, maxTokens?, description?, spawnableModels? }',
    )
  }

  const policies = Object.create(null) as Record<string, ModelPolicy>
  for (const [policyId, raw] of Object.entries(input)) {
    validateId(policyId, 'model policy id')
    if (!isPlainObject(raw)) {
      throw new Error('routed-subagent: model policy "' + policyId + '" must be a mapping')
    }
    const unknownField = Object.keys(raw).find(field => !POLICY_FIELDS.has(field))
    if (unknownField !== undefined) {
      throw new Error('routed-subagent: model policy "' + policyId + '" has unknown field "' + unknownField + '"')
    }
    if (!isNonEmptyString(raw.provider)) {
      throw new Error('routed-subagent: model policy "' + policyId + '" needs a non-empty provider route')
    }
    if (!isNonEmptyString(raw.model)) {
      throw new Error('routed-subagent: model policy "' + policyId + '" needs a non-empty model id')
    }
    validateId(raw.provider, 'provider route')
    validateId(raw.model, 'model id')
    if (raw.maxTokens !== undefined
      && (typeof raw.maxTokens !== 'number' || !Number.isSafeInteger(raw.maxTokens) || raw.maxTokens < 1)) {
      throw new Error('routed-subagent: model policy "' + policyId + '" maxTokens must be a positive integer')
    }
    if (raw.description !== undefined
      && (!isNonEmptyString(raw.description)
        || raw.description !== raw.description.trim()
        || raw.description.length > 500
        || /[\u0000-\u001f\u007f]/u.test(raw.description))) {
      throw new Error(
        'routed-subagent: model policy "' + policyId
        + '" description must be one trimmed line of at most 500 characters',
      )
    }

    const reasoningEfforts = parseStringList(policyId, 'reasoningEfforts', raw.reasoningEfforts, true)
    const spawnableModels = raw.spawnableModels === undefined
      ? []
      : parseStringList(policyId, 'spawnableModels', raw.spawnableModels, false)
    policies[policyId] = {
      provider: raw.provider,
      model: raw.model,
      reasoningEfforts,
      ...(raw.maxTokens === undefined ? {} : { maxTokens: raw.maxTokens }),
      ...(raw.description === undefined ? {} : { description: raw.description }),
      ...(spawnableModels.length === 0 ? {} : { spawnableModels }),
    }
  }

  for (const [policyId, policy] of Object.entries(policies)) {
    for (const ref of policy.spawnableModels ?? []) {
      if (policies[ref] === undefined) {
        throw new Error(
          'routed-subagent: model policy "' + policyId + '" spawns unknown model policy "' + ref + '"',
        )
      }
    }
  }
  return policies
}

/** Validate and resolve the non-empty top-level model allowlist. */
export function rootModelPolicyIds(policies: ModelPolicyTable, configured: unknown): readonly string[] {
  if (!Array.isArray(configured) || configured.length === 0 || configured.some(id => !isNonEmptyString(id))) {
    throw new Error('routed-subagent: rootModels must be a non-empty array of model policy ids')
  }
  const ids = configured as string[]
  for (const id of ids) validateId(id, 'rootModels entry')
  if (new Set(ids).size !== ids.length) {
    throw new Error('routed-subagent: rootModels must not contain duplicates')
  }
  for (const id of ids) {
    if (policies[id] === undefined) {
      throw new Error('routed-subagent: rootModels names unknown model policy "' + id + '"')
    }
  }
  return [...ids]
}

/** Resolve the configured recursive allowlist for a tracked child model. */
export function childModelPolicyIds(policies: ModelPolicyTable, callerPolicyId: string): readonly string[] {
  return policies[callerPolicyId]?.spawnableModels ?? []
}

/**
 * Classify one caller without treating an untracked delegated agent as a root.
 * A configuration-generation mismatch revokes recursive delegation immediately.
 */
export function allowedModelPolicyIds(
  policies: ModelPolicyTable,
  roots: readonly string[],
  delegationDepth: number,
  tracked: { generation: number; policyId: string } | undefined,
  currentGeneration: number,
): readonly string[] {
  if (delegationDepth === 0) return tracked === undefined ? roots : []
  if (tracked === undefined || tracked.generation !== currentGeneration) return []
  return childModelPolicyIds(policies, tracked.policyId)
}

/** Validate and detach one model-facing model/reasoning choice. */
export function resolveModelSelection(
  policies: ModelPolicyTable,
  allowed: readonly string[],
  policyId: string,
  reasoningEffort: string,
): ModelSelection {
  if (!allowed.includes(policyId)) {
    throw new Error(
      'model "' + policyId + '" is not available in this context (allowed here: '
      + (allowed.join(', ') || 'none') + ')',
    )
  }
  const policy = policies[policyId]
  if (policy === undefined) throw new Error('unknown model policy "' + policyId + '"')
  if (!policy.reasoningEfforts.includes(reasoningEffort)) {
    throw new Error(
      'reasoning_effort "' + reasoningEffort + '" is not allowed for model "' + policyId
      + '" (allowed: ' + policy.reasoningEfforts.join(', ') + ')',
    )
  }
  return {
    id: policyId,
    provider: policy.provider,
    model: policy.model,
    reasoningEffort,
  }
}
