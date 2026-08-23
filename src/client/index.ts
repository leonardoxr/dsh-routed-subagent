/** Browser settings card for routed subagent model policies. */
import { createElement as h, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { ensureStyles } from './styles.js'
import {
  catalogModel,
  loadModelCatalog,
  modelChoice,
  providerChoice,
  providerGroup,
  type CatalogFailure,
  type CatalogProviderGroup,
  type ModelCatalogApi,
} from './model-catalog.js'
import {
  blankModelPolicyRow,
  modelPolicyRows,
  modelPolicyRowsKey,
  parseReasoningEffortDraft,
  resetRoutedSettings,
  routerGeneralDraft,
  saveRoutedSettings,
  validateRoutedSettings,
  type BoundModelPolicyScope,
  type GeneralSettingsError,
  type RouterGeneralDraft,
  type ModelPolicyError,
  type ModelPolicyField,
  type ModelPolicyRow,
} from './model-policy-form.js'

const NS = 'routed-subagent'
type Dict = Record<string, string>

const en: Dict = {
  title: 'Routed subagent',
  description: 'Choose the exact models and reasoning efforts delegated agents may use. Saved changes apply immediately.',
  unsaved: 'Unsaved',
  generalTitle: 'Router behavior',
  generalIntro: 'Every option below is editable here and hot-applies after saving.',
  toolName: 'Tool name',
  toolNameHint: 'The tool name exposed to calling agents.',
  maxDepth: 'Maximum delegation depth',
  maxDepthHint: 'A positive whole number. 1 allows root agents to delegate once.',
  background: 'Background jobs',
  backgroundHint: 'Expose run_in_background on the routed tool.',
  policiesIntro: 'Each policy allowlists one provider/model pair and the reasoning efforts the caller may select per delegation.',
  addModelPolicy: 'Add model policy',
  policyName: 'Policy id',
  policyNameHint: 'The short model id exposed to the calling agent.',
  policyNamePlaceholder: 'e.g. codex-sol',
  rootBadge: 'root',
  rootAvailability: 'Root availability',
  rootHint: 'Make this policy selectable by top-level agents. At least one root policy is required.',
  rootToggle: 'Available to root agents',
  provider: 'Provider',
  providerHint: 'Choose an advertised provider or enter an exact custom route id.',
  selectProvider: 'Select a provider',
  model: 'Model',
  modelHint: 'Choose an advertised model or enter an exact custom model id.',
  selectModel: 'Select a model',
  maxTokens: 'Max output tokens',
  reasoningEfforts: 'Allowed reasoning efforts',
  reasoningHint: 'Select chips or enter comma-separated exact effort ids. At least one is required.',
  noReasoning: 'No efforts are advertised; enter exact effort ids manually.',
  effortEntryPlaceholder: 'low, medium, high',
  currentValue: 'Current custom value',
  catalogLoading: 'Loading the model catalog…',
  catalogReload: 'Refresh models',
  catalogFailed: 'Could not load models: ',
  catalogPartial: 'Some providers could not load: ',
  policyDescription: 'Routing guidance',
  descriptionHint: 'A concise cost, speed, and capability tradeoff shown to the calling agent.',
  descriptionPlaceholder: 'Best for architecture and difficult multi-step debugging.',
  spawnable: 'Child delegation',
  spawnableHint: 'Select model policies children on this model may use. No selection disables deeper delegation.',
  optional: 'optional',
  noPolicies: 'No model policies yet. Add one to build the delegation allowlist.',
  unnamedPolicy: 'New model policy',
  duplicate: 'Duplicate',
  moveUp: 'Move up',
  moveDown: 'Move down',
  remove: 'Remove',
  save: 'Save changes',
  saving: 'Saving…',
  discard: 'Discard changes',
  resetToComposition: 'Reset to composition',
  saved: 'Model policy settings saved.',
  resetDone: 'Using model policies from composition.',
  readOnly: 'These settings are read-only in the current profile.',
  saveFailed: 'Could not save: ',
  resetFailed: 'Could not reset: ',
  modelPolicyRequired: 'Add at least one model policy before saving.',
  nameRequired: 'Enter a policy id.',
  nameDuplicate: 'Policy ids must be unique.',
  rootModelRequired: 'Select at least one policy for root agents.',
  toolNameRequired: 'Enter a non-empty tool name without control characters.',
  maxDepthInvalid: 'Use a positive whole number.',
  providerRequired: 'Enter a provider route.',
  modelRequired: 'Enter a model id.',
  maxTokensInvalid: 'Use a positive whole number.',
  reasoningRequired: 'Select at least one unique reasoning effort.',
  descriptionInvalid: 'Use at most 500 characters.',
  spawnableInvalid: 'One selected child model policy no longer exists.',
}

const zh: Dict = {
  ...en,
  title: '路由子代理',
  description: '选择委派代理可使用的模型和推理强度。保存后立即生效。',
  addModelPolicy: '添加模型策略',
  save: '保存更改',
  discard: '放弃更改',
  remove: '删除',
}

interface RoutedScope extends BoundModelPolicyScope {
  getSnapshot(): ReturnType<BoundModelPolicyScope['getSnapshot']> & {
    status?: string
    user?: unknown
  }
  subscribe?(listener: () => void): () => void
}

interface CatalogState {
  status: 'idle' | 'loading' | 'ready' | 'error'
  groups: CatalogProviderGroup[]
  failures: CatalogFailure[]
  error?: string
}

interface ModelPoliciesCardProps {
  t: (key: string) => string
  scope: RoutedScope
  api: ModelCatalogApi
}

interface FieldProps {
  id: string
  label: string
  optional?: string
  hint?: string
  error?: string
  wide?: boolean
  children: ReactNode
}

function Field(props: FieldProps) {
  return h('div', { className: `rsa-field${props.wide ? ' rsa-field-wide' : ''}` },
    h('label', { className: 'rsa-label', htmlFor: props.id },
      props.label,
      props.optional === undefined ? null : h('span', { className: 'rsa-optional' }, ` · ${props.optional}`),
    ),
    props.children,
    h('p', { id: `${props.id}-error`, className: props.error === undefined ? 'rsa-hint' : 'rsa-error' }, props.error ?? props.hint ?? ''),
  )
}

function inputProps(id: string, value: string, disabled: boolean, error: string | undefined, onChange: (value: string) => void) {
  return {
    id,
    className: 'rsa-input',
    value,
    disabled,
    ...(error === undefined ? {} : { 'aria-invalid': true, 'aria-describedby': `${id}-error` }),
    onChange: (event: { target: { value: string } }) => { onChange(event.target.value) },
  }
}

function settingsDraftKey(rows: readonly ModelPolicyRow[], general: RouterGeneralDraft): string {
  return modelPolicyRowsKey(rows) + JSON.stringify(general)
}

function ModelPoliciesCard({ t, scope, api }: ModelPoliciesCardProps) {
  const initialValue = scope.getSnapshot().value
  const initial = modelPolicyRows(initialValue)
  const initialGeneral = routerGeneralDraft(initialValue)
  const [rows, setRows] = useState<ModelPolicyRow[]>(initial)
  const [general, setGeneral] = useState<RouterGeneralDraft>(initialGeneral)
  const [baseline, setBaseline] = useState(() => settingsDraftKey(initial, initialGeneral))
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [status, setStatus] = useState<{ text: string; error: boolean } | undefined>()
  const [scopeRevision, setScopeRevision] = useState(0)
  const [catalog, setCatalog] = useState<CatalogState>({ status: 'idle', groups: [], failures: [] })
  const nextId = useRef(0)
  const catalogGeneration = useRef(0)

  const dirty = settingsDraftKey(rows, general) !== baseline
  const snapshot = scope.getSnapshot()
  const validation = useMemo(() => validateRoutedSettings(rows, general), [rows, general, scopeRevision])
  const invalid = validation.settings === undefined
  const writable = snapshot.writable !== false

  const refreshCatalog = async (): Promise<void> => {
    const generation = ++catalogGeneration.current
    setCatalog(current => ({ ...current, status: 'loading', error: undefined }))
    try {
      const value = await loadModelCatalog(api)
      if (generation !== catalogGeneration.current) return
      setCatalog({ status: 'ready', ...value })
    } catch (reason) {
      if (generation !== catalogGeneration.current) return
      const message = String(reason instanceof Error ? reason.message : reason)
      setCatalog(current => ({ ...current, status: 'error', error: message }))
    }
  }

  useEffect(() => scope.subscribe?.(() => { setScopeRevision(value => value + 1) }), [scope])
  useEffect(() => {
    if (!open) return
    void refreshCatalog()
  }, [open])
  useEffect(() => {
    if (dirty) return
    const value = scope.getSnapshot().value
    const loaded = modelPolicyRows(value)
    const loadedGeneral = routerGeneralDraft(value)
    const key = settingsDraftKey(loaded, loadedGeneral)
    if (key === baseline) return
    setRows(loaded)
    setGeneral(loadedGeneral)
    setBaseline(key)
  }, [scopeRevision, scope, dirty, baseline])

  if (snapshot.status !== undefined && snapshot.status !== 'ready') return null

  const clearStatus = (): void => { setStatus(undefined) }
  const updateGeneral = (update: Partial<RouterGeneralDraft>): void => {
    setGeneral(current => ({ ...current, ...update }))
    clearStatus()
  }
  const generalError = (field: 'toolName' | 'maxDepth'): string | undefined => {
    const code = validation.generalErrors[field] as GeneralSettingsError | undefined
    return code === undefined ? undefined : t(code)
  }
  const updateRow = (id: string, update: Partial<ModelPolicyRow>): void => {
    setRows(current => current.map(row => row.id === id ? { ...row, ...update } : row))
    clearStatus()
  }
  const errorFor = (row: ModelPolicyRow, field: ModelPolicyField): string | undefined => {
    const code = validation.errors[row.id]?.[field] as ModelPolicyError | undefined
    return code === undefined ? undefined : t(code)
  }
  const addModelPolicy = (): void => {
    const row = blankModelPolicyRow(`new-${nextId.current++}`)
    setRows(current => [...current, row])
    clearStatus()
  }
  const removeModelPolicy = (id: string): void => {
    if (rows.find(row => row.id === id)?.root === true) return
    setRows(current => current
      .filter(row => row.id !== id)
      .map(row => ({ ...row, spawnableIds: row.spawnableIds.filter(candidate => candidate !== id) })))
    clearStatus()
  }
  const duplicateModelPolicy = (source: ModelPolicyRow): void => {
    const used = new Set(rows.map(row => row.name.trim()))
    const stem = (source.name.trim() || 'model') + '-copy'
    let name = stem
    let suffix = 2
    while (used.has(name)) name = stem + '-' + suffix++
    setRows(current => [...current, {
      ...source,
      id: 'new-' + nextId.current++,
      name,
      originalName: name,
      root: false,
      reasoningEfforts: [...source.reasoningEfforts],
      spawnableIds: [...source.spawnableIds],
    }])
    clearStatus()
  }
  const moveModelPolicy = (index: number, offset: -1 | 1): void => {
    setRows(current => {
      const target = index + offset
      if (target < 0 || target >= current.length) return current
      const next = [...current]
      const [row] = next.splice(index, 1)
      if (row !== undefined) next.splice(target, 0, row)
      return next
    })
    clearStatus()
  }
  const toggleSpawnableModel = (row: ModelPolicyRow, targetId: string): void => {
    updateRow(row.id, {
      spawnableIds: row.spawnableIds.includes(targetId)
        ? row.spawnableIds.filter(id => id !== targetId)
        : [...row.spawnableIds, targetId],
    })
  }
  const toggleReasoningEffort = (row: ModelPolicyRow, effortId: string): void => {
    updateRow(row.id, {
      reasoningEfforts: row.reasoningEfforts.includes(effortId)
        ? row.reasoningEfforts.filter(id => id !== effortId)
        : [...row.reasoningEfforts, effortId],
    })
  }
  const discard = (): void => {
    const value = scope.getSnapshot().value
    const loaded = modelPolicyRows(value)
    const loadedGeneral = routerGeneralDraft(value)
    setRows(loaded)
    setGeneral(loadedGeneral)
    setBaseline(settingsDraftKey(loaded, loadedGeneral))
    clearStatus()
  }
  const save = async (): Promise<void> => {
    if (!dirty || invalid || saving || !writable) return
    setSaving(true)
    clearStatus()
    try {
      const result = await saveRoutedSettings(scope, rows, general)
      if (result.settings === undefined) return
      setBaseline(settingsDraftKey(rows, general))
      setStatus({ text: t('saved'), error: false })
    } catch (reason) {
      setStatus({ text: t('saveFailed') + String(reason instanceof Error ? reason.message : reason), error: true })
    } finally {
      setSaving(false)
    }
  }
  const reset = async (): Promise<void> => {
    if (saving || !writable) return
    setSaving(true)
    clearStatus()
    try {
      await resetRoutedSettings(scope)
      const value = scope.getSnapshot().value
      const loaded = modelPolicyRows(value)
      const loadedGeneral = routerGeneralDraft(value)
      setRows(loaded)
      setGeneral(loadedGeneral)
      setBaseline(settingsDraftKey(loaded, loadedGeneral))
      setStatus({ text: t('resetDone'), error: false })
    } catch (reason) {
      setStatus({ text: t('resetFailed') + String(reason instanceof Error ? reason.message : reason), error: true })
    } finally {
      setSaving(false)
    }
  }

  return h('li', { className: 'rsa-card', 'data-open': String(open) },
    h('button', {
      type: 'button',
      className: 'rsa-card-header',
      'aria-expanded': open,
      onClick: () => { setOpen(value => !value) },
    },
    h('span', { className: 'rsa-card-heading' },
      h('span', { className: 'rsa-card-title' }, t('title')),
      h('span', { className: 'rsa-card-description' }, t('description')),
    ),
    dirty ? h('span', { className: 'rsa-unsaved' }, t('unsaved')) : null,
    h('span', { className: 'rsa-chevron', 'aria-hidden': true }, '⌄'),
    ),
    !open ? null : h('div', { className: 'rsa-card-body' },
      !writable ? h('p', { className: 'rsa-readonly', role: 'status' }, t('readOnly')) : null,
      h('section', { className: 'rsa-tier' },
        h('span', { className: 'rsa-tier-label' }, t('generalTitle')),
        h('p', { className: 'rsa-section-copy', style: { marginBottom: 12 } }, t('generalIntro')),
        h('div', { className: 'rsa-grid' },
          h(Field, { id: 'rsa-tool-name', label: t('toolName'), hint: t('toolNameHint'), error: generalError('toolName') },
            h('input', {
              ...inputProps('rsa-tool-name', general.toolName, !writable || saving, generalError('toolName'), value => { updateGeneral({ toolName: value }) }),
              placeholder: 'routed_subagent',
            }),
          ),
          h(Field, { id: 'rsa-max-depth', label: t('maxDepth'), hint: t('maxDepthHint'), error: generalError('maxDepth') },
            h('input', {
              ...inputProps('rsa-max-depth', general.maxDepth, !writable || saving, generalError('maxDepth'), value => { updateGeneral({ maxDepth: value }) }),
              inputMode: 'numeric',
              placeholder: '1',
            }),
          ),
          h(Field, { id: 'rsa-background', label: t('background'), hint: t('backgroundHint'), wide: true },
            h('div', { id: 'rsa-background', className: 'rsa-chips' },
              h('button', {
                type: 'button',
                className: 'rsa-chip',
                'data-selected': String(general.enableRunInBackground),
                'aria-pressed': general.enableRunInBackground,
                disabled: !writable || saving,
                onClick: () => { updateGeneral({ enableRunInBackground: !general.enableRunInBackground }) },
              }, t('background')),
            ),
          ),
        ),
      ),
      h('div', { className: 'rsa-toolbar', style: { marginTop: 12 } },
        h('p', { className: 'rsa-section-copy' }, t('policiesIntro')),
        h('div', { className: 'rsa-toolbar-actions' },
          h('button', { type: 'button', className: 'rsa-button', disabled: catalog.status === 'loading', onClick: () => { void refreshCatalog() } }, t('catalogReload')),
          h('button', { type: 'button', className: 'rsa-button', disabled: !writable || saving, onClick: addModelPolicy }, `＋ ${t('addModelPolicy')}`),
        ),
      ),
      catalog.status === 'loading' && catalog.groups.length === 0
        ? h('p', { className: 'rsa-catalog-notice', role: 'status' }, t('catalogLoading'))
        : null,
      catalog.status === 'error'
        ? h('p', { className: 'rsa-catalog-notice rsa-catalog-error', role: 'status' }, t('catalogFailed') + (catalog.error ?? ''))
        : null,
      catalog.failures.length === 0
        ? null
        : h('p', { className: 'rsa-catalog-notice rsa-catalog-warning', role: 'status' },
          t('catalogPartial') + catalog.failures.map(failure => `${failure.name}: ${failure.message}`).join('; '),
        ),
      rows.length === 0
        ? h('div', { className: 'rsa-empty' }, t('noPolicies'))
        : h('div', { className: 'rsa-tier-list' }, rows.map((row, index) => {
          const prefix = 'rsa-model-' + row.id
          const nameError = errorFor(row, 'name')
          const providerError = errorFor(row, 'provider')
          const modelError = errorFor(row, 'model')
          const maxTokensError = errorFor(row, 'maxTokens')
          const reasoningError = errorFor(row, 'reasoningEfforts')
          const descriptionError = errorFor(row, 'description')
          const spawnableError = errorFor(row, 'spawnableIds')
          const group = providerGroup(catalog.groups, row.provider)
          const selectedModel = catalogModel(catalog.groups, row.provider, row.model)
          const advertisedEfforts = selectedModel?.reasoning?.efforts ?? []
          const customEfforts = row.reasoningEfforts
            .filter(id => id !== '' && !advertisedEfforts.some(effort => effort.id === id))
            .map(id => ({ id, name: id + ' — ' + t('currentValue'), description: undefined }))
          const efforts = [...advertisedEfforts, ...customEfforts]
          return h('section', {
            className: 'rsa-tier',
            key: row.id,
            'aria-label': row.name.trim() || t('unnamedPolicy') + ' ' + (index + 1),
          },
            h('div', { className: 'rsa-tier-head' },
              h('div', { className: 'rsa-tier-index' },
                h('span', { className: 'rsa-tier-label' }, t('title') + ' · ' + (index + 1) + (row.root ? ' · ' + t('rootBadge') : '')),
                h('input', {
                  ...inputProps(prefix + '-name', row.name, !writable || saving || row.root, nameError, value => { updateRow(row.id, { name: value }) }),
                  placeholder: t('policyNamePlaceholder'),
                  'aria-label': t('policyName'),
                }),
                h('p', { id: prefix + '-name-error', className: nameError === undefined ? 'rsa-hint' : 'rsa-error' }, nameError ?? t('policyNameHint')),
              ),
              h('button', { type: 'button', className: 'rsa-icon-button', title: t('moveUp'), 'aria-label': t('moveUp'), disabled: !writable || saving || index === 0, onClick: () => { moveModelPolicy(index, -1) } }, '↑'),
              h('button', { type: 'button', className: 'rsa-icon-button', title: t('moveDown'), 'aria-label': t('moveDown'), disabled: !writable || saving || index === rows.length - 1, onClick: () => { moveModelPolicy(index, 1) } }, '↓'),
              h('button', { type: 'button', className: 'rsa-icon-button', title: t('duplicate'), 'aria-label': t('duplicate'), disabled: !writable || saving, onClick: () => { duplicateModelPolicy(row) } }, '⧉'),
              h('button', { type: 'button', className: 'rsa-icon-button', title: t('remove'), 'aria-label': t('remove'), disabled: !writable || saving || row.root, onClick: () => { removeModelPolicy(row.id) } }, '×'),
            ),
            h('div', { className: 'rsa-grid' },
              h(Field, { id: prefix + '-root', label: t('rootAvailability'), hint: t('rootHint'), wide: true },
                h('div', { id: prefix + '-root', className: 'rsa-chips' },
                  h('button', {
                    type: 'button',
                    className: 'rsa-chip',
                    'data-selected': String(row.root),
                    'aria-pressed': row.root,
                    disabled: !writable || saving,
                    onClick: () => { updateRow(row.id, { root: !row.root }) },
                  }, t('rootToggle')),
                ),
              ),
              h(Field, { id: prefix + '-provider', label: t('provider'), hint: t('providerHint'), error: providerError },
                h('input', {
                  ...inputProps(prefix + '-provider', row.provider, !writable || saving, providerError, value => {
                    updateRow(row.id, providerChoice(catalog.groups, value))
                  }),
                  list: prefix + '-provider-options',
                  placeholder: t('selectProvider'),
                }),
                h('datalist', { id: prefix + '-provider-options' }, catalog.groups.map(candidate => h('option', {
                  key: candidate.id,
                  value: candidate.id,
                  label: candidate.name,
                }))),
              ),
              h(Field, { id: prefix + '-model', label: t('model'), hint: selectedModel?.description ?? t('modelHint'), error: modelError },
                h('input', {
                  ...inputProps(prefix + '-model', row.model, !writable || saving, modelError, value => {
                    updateRow(row.id, modelChoice(catalog.groups, row.provider, value))
                  }),
                  list: prefix + '-model-options',
                  placeholder: t('selectModel'),
                }),
                h('datalist', { id: prefix + '-model-options' }, (group?.models ?? []).map(candidate => h('option', {
                  key: candidate.id,
                  value: candidate.id,
                  label: candidate.name,
                }))),
              ),
              h(Field, { id: prefix + '-tokens', label: t('maxTokens'), optional: t('optional'), error: maxTokensError },
                h('input', { ...inputProps(prefix + '-tokens', row.maxTokens, !writable || saving, maxTokensError, value => { updateRow(row.id, { maxTokens: value }) }), inputMode: 'numeric', placeholder: '16384' }),
              ),
              h(Field, { id: prefix + '-efforts', label: t('reasoningEfforts'), hint: efforts.length === 0 ? t('noReasoning') : t('reasoningHint'), error: reasoningError, wide: true },
                h('div', { id: prefix + '-efforts', className: 'rsa-chips' }, efforts.map(effort => h('button', {
                  type: 'button', key: effort.id, className: 'rsa-chip',
                  'data-selected': String(row.reasoningEfforts.includes(effort.id)),
                  'aria-pressed': row.reasoningEfforts.includes(effort.id),
                  disabled: !writable || saving,
                  title: effort.description,
                  onClick: () => { toggleReasoningEffort(row, effort.id) },
                }, effort.name))),
                h('input', {
                  ...inputProps(prefix + '-efforts-custom', row.reasoningEfforts.join(', '), !writable || saving, reasoningError, value => {
                    updateRow(row.id, { reasoningEfforts: parseReasoningEffortDraft(value) })
                  }),
                  style: { marginTop: 8 },
                  placeholder: t('effortEntryPlaceholder'),
                  'aria-label': t('reasoningEfforts'),
                }),
              ),
              h(Field, { id: prefix + '-description', label: t('policyDescription'), optional: t('optional'), hint: t('descriptionHint'), error: descriptionError, wide: true },
                h('textarea', { id: prefix + '-description', className: 'rsa-textarea', value: row.description, disabled: !writable || saving, placeholder: t('descriptionPlaceholder'), onChange: (event: { target: { value: string } }) => { updateRow(row.id, { description: event.target.value }) } }),
              ),
              h(Field, { id: prefix + '-spawnable', label: t('spawnable'), optional: t('optional'), hint: t('spawnableHint'), error: spawnableError, wide: true },
                h('div', { id: prefix + '-spawnable', className: 'rsa-chips' }, rows.map((target, targetIndex) => h('button', {
                  type: 'button', key: target.id, className: 'rsa-chip',
                  'data-selected': String(row.spawnableIds.includes(target.id)),
                  'aria-pressed': row.spawnableIds.includes(target.id),
                  disabled: !writable || saving,
                  onClick: () => { toggleSpawnableModel(row, target.id) },
                }, target.name.trim() || t('unnamedPolicy') + ' ' + (targetIndex + 1)))),
              ),
            ),
          )
        })),
      h('div', { className: 'rsa-footer' },
        h('button', { type: 'button', className: 'rsa-button', disabled: !writable || saving, onClick: () => { void reset() } }, t('resetToComposition')),
        h('p', { className: 'rsa-status', 'data-error': String(status?.error === true || validation.formError !== undefined), role: 'status' }, status?.text ?? (validation.formError === undefined ? '' : t(validation.formError))),
        h('button', { type: 'button', className: 'rsa-button', disabled: !dirty || saving, onClick: discard }, t('discard')),
        h('button', { type: 'button', className: 'rsa-button rsa-button-primary', disabled: !dirty || invalid || saving || !writable, onClick: () => { void save() } }, t(saving ? 'saving' : 'save')),
      ),
    ),
  )
}

interface RoutedClientContext {
  effect(callback: () => unknown, label?: string): void
  get(name: 'connection'): { api: ModelCatalogApi }
  locale: {
    register(namespace: string, dicts: { zh: Record<string, string>; en: Record<string, string> }): unknown
    bind(namespace: string): (key: string) => string
  }
  slots: {
    inject(slot: string, register: () => unknown): void
    register(meta: Record<string, unknown>, component: () => unknown): unknown
  }
}

export const name = 'routed-subagent'
export const inject = ['slots', 'locale', 'connection']

export function apply(ctx: RoutedClientContext): void {
  ensureStyles()
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'routed-subagent: card dictionaries')
  const t = ctx.locale.bind(NS)
  const settingsCtx = ctx as unknown as {
    inject(services: string[], callback: (scoped: RoutedClientContext & { settingsScope: { bind(options: { namespace: string }): RoutedScope } }) => void): void
  }
  settingsCtx.inject(['settingsScope', 'connection'], (scoped) => {
    const scope = scoped.settingsScope.bind({ namespace: NS })
    const api = scoped.get('connection').api
    scoped.slots.inject('settings.plugin.item', () => scoped.slots.register({
      name: 'settings.plugin.item',
      key: NS,
      locale: NS,
      inject: () => ({ t }),
    }, () => h(ModelPoliciesCard, { t, scope, api })))
  })
}
