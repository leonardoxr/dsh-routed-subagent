/**
 * Pure tier-table logic for the routed subagent tool: validation at load,
 * caller-scoped availability, and the spawn-chain policy. No harness imports —
 * everything here is unit-testable without a Cordis context.
 * @module dsh-routed-subagent/tiers
 */

/** One configured runtime tier: where a delegated child runs and what it may spawn. */
export interface TierDefinition {
  /** LLM provider route the child's requests use (must resolve to a registered adapter at call time). */
  provider: string
  /** Model id interpreted by the selected provider adapter. */
  model: string
  /** Optional per-request output-token cap for the child. */
  maxTokens?: number
  /**
   * Optional reasoning effort applied to every child request through the
   * `agent/request` waterfall, overriding whatever the child inherited.
   */
  reasoningEffort?: string
  /** Optional per-child persona shadowing the deployment persona. Requires the provider's persona capability. */
  persona?: string
  /**
   * One-line guidance shown to the calling model next to this tier's name in
   * the tool description — the actual routing signal.
   */
  guidance?: string
  /**
   * Tier names children of THIS tier may delegate to. Defaults to no further
   * delegation; unknown names fail the load.
   */
  spawnable?: readonly string[]
}

/** The validated tier table keyed by tier name. */
export type TierTable = Readonly<Record<string, TierDefinition>>

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Validate raw configuration into a {@link TierTable}, failing loud with an
 * actionable message naming the first problem found.
 * @param input - the raw `tiers` mapping as read from cordis.yml.
 * @returns the validated table (same shape, narrowed types).
 * @throws when the table is absent, empty, or any entry or reference is invalid.
 */
export function parseTierTable(input: unknown): TierTable {
  if (!isPlainObject(input) || Object.keys(input).length === 0) {
    throw new Error(
      'routed-subagent: `tiers` must be a non-empty mapping of tier name → '
      + '{ provider, model, maxTokens?, reasoningEffort?, persona?, guidance?, spawnable? }',
    )
  }
  const tiers: Record<string, TierDefinition> = {}
  for (const [name, raw] of Object.entries(input)) {
    if (!isPlainObject(raw)) throw new Error(`routed-subagent: tier "${name}" must be a mapping`)
    const { provider, model } = raw as Partial<TierDefinition>
    if (typeof provider !== 'string' || provider === '') {
      throw new Error(`routed-subagent: tier "${name}" needs a non-empty "provider" route`)
    }
    if (typeof model !== 'string' || model === '') {
      throw new Error(`routed-subagent: tier "${name}" needs a non-empty "model" id`)
    }
    if (raw.maxTokens !== undefined && (typeof raw.maxTokens !== 'number' || !Number.isSafeInteger(raw.maxTokens) || raw.maxTokens < 1)) {
      throw new Error(`routed-subagent: tier "${name}" maxTokens must be a positive integer`)
    }
    if (raw.reasoningEffort !== undefined && (typeof raw.reasoningEffort !== 'string' || raw.reasoningEffort === '')) {
      throw new Error(`routed-subagent: tier "${name}" reasoningEffort must be a non-empty adapter-owned id`)
    }
    if (raw.persona !== undefined && (typeof raw.persona !== 'string' || raw.persona === '')) {
      throw new Error(`routed-subagent: tier "${name}" persona must be a non-empty string`)
    }
    if (raw.guidance !== undefined && (typeof raw.guidance !== 'string' || raw.guidance === '')) {
      throw new Error(`routed-subagent: tier "${name}" guidance must be a non-empty string`)
    }
    if (raw.spawnable !== undefined && (!Array.isArray(raw.spawnable) || raw.spawnable.some(entry => typeof entry !== 'string'))) {
      throw new Error(`routed-subagent: tier "${name}" spawnable must be an array of tier names`)
    }
    tiers[name] = {
      provider,
      model,
      ...(raw.maxTokens !== undefined ? { maxTokens: raw.maxTokens } : {}),
      ...(raw.reasoningEffort !== undefined ? { reasoningEffort: raw.reasoningEffort } : {}),
      ...(raw.persona !== undefined ? { persona: raw.persona } : {}),
      ...(raw.guidance !== undefined ? { guidance: raw.guidance } : {}),
      ...(raw.spawnable !== undefined ? { spawnable: raw.spawnable as readonly string[] } : {}),
    }
  }
  // Reference pass runs after every tier exists, so forward references are fine.
  for (const [name, tier] of Object.entries(tiers)) {
    for (const ref of tier.spawnable ?? []) {
      if (tiers[ref] === undefined) {
        throw new Error(`routed-subagent: tier "${name}" spawns unknown tier "${ref}"`)
      }
    }
  }
  return tiers
}

/**
 * Resolve the root delegation menu: the configured allowlist, defaulting to
 * every configured tier.
 * @param tiers - the validated tier table.
 * @param configured - explicit `rootTiers` from config, when present.
 * @returns the ordered tier names top-level agents may delegate to.
 * @throws when a configured root tier names no entry in the table.
 */
export function rootTierNames(tiers: TierTable, configured: readonly string[] | undefined): readonly string[] {
  if (configured === undefined) return Object.keys(tiers)
  for (const name of configured) {
    if (tiers[name] === undefined) {
      throw new Error(`routed-subagent: rootTiers names unknown tier "${name}"`)
    }
  }
  return configured
}

/**
 * Resolve which tiers ONE calling context may delegate to. Top-level agents
 * get the root menu; a spawned child gets its tier's spawn chain; an unknown
 * context (stale tracking after recomposition) gets nothing.
 * @param tiers - the validated tier table.
 * @param roots - the resolved root menu.
 * @param callerTier - the caller's tracked tier, or undefined at top level.
 * @returns the allowed tier names, in table order for stable prompts.
 */
export function allowedTiersFor(
  tiers: TierTable,
  roots: readonly string[],
  callerTier: string | undefined,
): readonly string[] {
  if (callerTier === undefined) return roots
  return tiers[callerTier]?.spawnable ?? []
}
