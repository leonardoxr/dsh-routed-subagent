/** Browser settings card for the routed-subagent tier table. */
import { createElement as h, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { ensureStyles } from './styles.js'
import {
  catalogModel,
  loadModelCatalog,
  modelDefaults,
  providerDefaults,
  providerGroup,
  type CatalogFailure,
  type CatalogProviderGroup,
  type ModelCatalogApi,
} from './model-catalog.js'
import {
  blankTierRow,
  resetTierRows,
  saveTierRows,
  tierRows,
  tierRowsKey,
  validateTierRows,
  type BoundTierScope,
  type TierError,
  type TierField,
  type TierRow,
} from './tier-form.js'

const NS = 'routed-subagent'

type Dict = Record<string, string>

const en: Dict = {
  title: 'Routed subagent',
  description: 'Build the runtime tiers available to delegated agents. Changes apply to new delegations immediately.',
  unsaved: 'Unsaved',
  tiersIntro: 'Each tier selects a provider and model. Optional controls tune that runtime and define which tiers its children may use.',
  addTier: 'Add tier',
  tierName: 'Tier name',
  tierNameHint: 'The short id the calling model selects.',
  tierNamePlaceholder: 'e.g. fast',
  provider: 'Provider',
  providerHint: 'Choose from the provider routes available in Chat.',
  selectProvider: 'Select a provider',
  model: 'Model',
  modelHint: 'Choose a model advertised by this provider.',
  selectModel: 'Select a model',
  maxTokens: 'Max output tokens',
  reasoningEffort: 'Reasoning effort',
  reasoningHint: 'Effort levels come from the selected model.',
  providerDefault: 'Provider default',
  noReasoning: 'No reasoning levels offered',
  currentValue: 'Current custom value',
  catalogLoading: 'Loading the model catalog…',
  catalogReload: 'Refresh models',
  catalogFailed: 'Could not load models: ',
  catalogPartial: 'Some providers could not load: ',
  persona: 'Persona',
  guidance: 'Routing guidance',
  guidanceHint: 'A concise tradeoff the calling model sees when choosing a tier.',
  guidancePlaceholder: 'Best for lookups and small, mechanical changes.',
  spawnable: 'Child delegation',
  spawnableHint: 'Select the tiers that an agent running in this tier may delegate to. No selection disables deeper delegation.',
  optional: 'optional',
  noTiers: 'No tiers yet. Add one to start building the delegation menu.',
  unnamedTier: 'New tier',
  duplicate: 'Duplicate',
  moveUp: 'Move up',
  moveDown: 'Move down',
  remove: 'Remove',
  save: 'Save changes',
  saving: 'Saving…',
  discard: 'Discard changes',
  resetToComposition: 'Reset to composition',
  saved: 'Tier settings saved.',
  resetDone: 'Using the tier table from composition.',
  readOnly: 'These settings are read-only in the current profile.',
  saveFailed: 'Could not save: ',
  resetFailed: 'Could not reset: ',
  tierRequired: 'Add at least one tier before saving.',
  nameRequired: 'Enter a tier name.',
  nameDuplicate: 'Tier names must be unique.',
  providerRequired: 'Enter a provider route.',
  modelRequired: 'Enter a model id.',
  maxTokensInvalid: 'Use a positive whole number.',
  spawnableInvalid: 'One selected child tier no longer exists.',
}

const zh: Dict = {
  title: '路由子代理',
  description: '构建委派代理可使用的运行时层级。更改会立即应用于新的委派。',
  unsaved: '未保存',
  tiersIntro: '每个层级选择一个提供商和模型。可选项用于调整运行时，并定义其子代理可使用的层级。',
  addTier: '添加层级',
  tierName: '层级名称',
  tierNameHint: '调用模型选择时使用的简短标识。',
  tierNamePlaceholder: '例如 fast',
  provider: '提供商',
  providerHint: '从聊天中可用的提供商路由中选择。',
  selectProvider: '选择提供商',
  model: '模型',
  modelHint: '选择该提供商公布的模型。',
  selectModel: '选择模型',
  maxTokens: '最大输出令牌数',
  reasoningEffort: '推理强度',
  reasoningHint: '推理等级来自所选模型。',
  providerDefault: '提供商默认值',
  noReasoning: '此模型未提供推理等级',
  currentValue: '当前自定义值',
  catalogLoading: '正在加载模型目录…',
  catalogReload: '刷新模型',
  catalogFailed: '无法加载模型：',
  catalogPartial: '部分提供商无法加载：',
  persona: '角色',
  guidance: '路由说明',
  guidanceHint: '调用模型选择层级时看到的简短取舍说明。',
  guidancePlaceholder: '适合查询和小型机械修改。',
  spawnable: '子级委派',
  spawnableHint: '选择此层级中的代理可继续委派到的层级。不选择则禁用更深层委派。',
  optional: '可选',
  noTiers: '尚无层级。添加一个层级以开始构建委派菜单。',
  unnamedTier: '新层级',
  duplicate: '复制',
  moveUp: '上移',
  moveDown: '下移',
  remove: '删除',
  save: '保存更改',
  saving: '正在保存…',
  discard: '放弃更改',
  resetToComposition: '恢复为组合配置',
  saved: '层级设置已保存。',
  resetDone: '正在使用组合配置中的层级表。',
  readOnly: '当前配置文件中的这些设置为只读。',
  saveFailed: '无法保存：',
  resetFailed: '无法重置：',
  tierRequired: '保存前请至少添加一个层级。',
  nameRequired: '请输入层级名称。',
  nameDuplicate: '层级名称必须唯一。',
  providerRequired: '请输入提供商路由。',
  modelRequired: '请输入模型 ID。',
  maxTokensInvalid: '请输入正整数。',
  spawnableInvalid: '一个已选择的子层级已不存在。',
}

interface RoutedScope extends BoundTierScope {
  getSnapshot(): ReturnType<BoundTierScope['getSnapshot']> & {
    status?: string
    user?: { tiers?: unknown }
    base?: { tiers?: unknown }
  }
  subscribe?(listener: () => void): () => void
}

interface CatalogState {
  status: 'idle' | 'loading' | 'ready' | 'error'
  groups: CatalogProviderGroup[]
  failures: CatalogFailure[]
  error?: string
}

interface TiersCardProps {
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

function TiersCard({ t, scope, api }: TiersCardProps) {
  const initial = tierRows(scope.getSnapshot().value)
  const [rows, setRows] = useState<TierRow[]>(initial)
  const [baseline, setBaseline] = useState(() => tierRowsKey(initial))
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [status, setStatus] = useState<{ text: string; error: boolean } | undefined>()
  const [scopeRevision, setScopeRevision] = useState(0)
  const [catalog, setCatalog] = useState<CatalogState>({ status: 'idle', groups: [], failures: [] })
  const nextId = useRef(0)
  const catalogGeneration = useRef(0)

  const dirty = tierRowsKey(rows) !== baseline
  const validation = useMemo(() => validateTierRows(rows), [rows])
  const invalid = validation.tiers === undefined
  const snapshot = scope.getSnapshot()
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
    const loaded = tierRows(scope.getSnapshot().value)
    const key = tierRowsKey(loaded)
    if (key === baseline) return
    setRows(loaded)
    setBaseline(key)
  }, [scopeRevision, scope, dirty, baseline])

  if (snapshot.status !== undefined && snapshot.status !== 'ready') return null

  const clearStatus = (): void => { setStatus(undefined) }
  const updateRow = (id: string, update: Partial<TierRow>): void => {
    setRows(current => current.map(row => row.id === id ? { ...row, ...update } : row))
    clearStatus()
  }
  const errorFor = (row: TierRow, field: TierField): string | undefined => {
    const code = validation.errors[row.id]?.[field] as TierError | undefined
    return code === undefined ? undefined : t(code)
  }
  const addTier = (): void => {
    const row = blankTierRow(`new-${nextId.current++}`)
    setRows(current => [...current, row])
    clearStatus()
  }
  const removeTier = (id: string): void => {
    setRows(current => current
      .filter(row => row.id !== id)
      .map(row => ({ ...row, spawnableIds: row.spawnableIds.filter(candidate => candidate !== id) })))
    clearStatus()
  }
  const duplicateTier = (source: TierRow): void => {
    const used = new Set(rows.map(row => row.name.trim()))
    const stem = `${source.name.trim() || 'tier'}-copy`
    let name = stem
    let suffix = 2
    while (used.has(name)) name = `${stem}-${suffix++}`
    setRows(current => [...current, { ...source, id: `new-${nextId.current++}`, name, extras: { ...source.extras } }])
    clearStatus()
  }
  const moveTier = (index: number, offset: -1 | 1): void => {
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
  const toggleSpawnable = (row: TierRow, targetId: string): void => {
    updateRow(row.id, {
      spawnableIds: row.spawnableIds.includes(targetId)
        ? row.spawnableIds.filter(id => id !== targetId)
        : [...row.spawnableIds, targetId],
    })
  }
  const discard = (): void => {
    const loaded = tierRows(scope.getSnapshot().value)
    setRows(loaded)
    setBaseline(tierRowsKey(loaded))
    clearStatus()
  }
  const save = async (): Promise<void> => {
    if (!dirty || invalid || saving || !writable) return
    setSaving(true)
    clearStatus()
    try {
      const result = await saveTierRows(scope, rows)
      if (result.tiers === undefined) return
      setBaseline(tierRowsKey(rows))
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
      await resetTierRows(scope)
      const loaded = tierRows(scope.getSnapshot().value)
      setRows(loaded)
      setBaseline(tierRowsKey(loaded))
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
      h('div', { className: 'rsa-toolbar' },
        h('p', { className: 'rsa-section-copy' }, t('tiersIntro')),
        h('div', { className: 'rsa-toolbar-actions' },
          h('button', { type: 'button', className: 'rsa-button', disabled: catalog.status === 'loading', onClick: () => { void refreshCatalog() } }, t('catalogReload')),
          h('button', { type: 'button', className: 'rsa-button', disabled: !writable || saving, onClick: addTier }, `＋ ${t('addTier')}`),
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
        ? h('div', { className: 'rsa-empty' }, t('noTiers'))
        : h('div', { className: 'rsa-tier-list' }, rows.map((row, index) => {
          const prefix = `rsa-tier-${row.id}`
          const nameError = errorFor(row, 'name')
          const providerError = errorFor(row, 'provider')
          const modelError = errorFor(row, 'model')
          const maxTokensError = errorFor(row, 'maxTokens')
          const spawnableError = errorFor(row, 'spawnableIds')
          const group = providerGroup(catalog.groups, row.provider)
          const selectedModel = catalogModel(catalog.groups, row.provider, row.model)
          const efforts = selectedModel?.reasoning?.efforts ?? []
          const defaultEffort = selectedModel?.reasoning?.defaultEffort
          const defaultEffortName = efforts.find(effort => effort.id === defaultEffort)?.name
          const defaultEffortLabel = defaultEffortName === undefined
            ? t('providerDefault')
            : `${t('providerDefault')} · ${defaultEffortName}`
          return h('section', { className: 'rsa-tier', key: row.id, 'aria-label': row.name.trim() || `${t('unnamedTier')} ${index + 1}` },
            h('div', { className: 'rsa-tier-head' },
              h('div', { className: 'rsa-tier-index' },
                h('span', { className: 'rsa-tier-label' }, `${t('title')} · ${index + 1}`),
                h('input', {
                  ...inputProps(`${prefix}-name`, row.name, !writable || saving, nameError, value => { updateRow(row.id, { name: value }) }),
                  placeholder: t('tierNamePlaceholder'),
                  'aria-label': t('tierName'),
                }),
                h('p', { id: `${prefix}-name-error`, className: nameError === undefined ? 'rsa-hint' : 'rsa-error' }, nameError ?? t('tierNameHint')),
              ),
              h('button', { type: 'button', className: 'rsa-icon-button', title: t('moveUp'), 'aria-label': t('moveUp'), disabled: !writable || saving || index === 0, onClick: () => { moveTier(index, -1) } }, '↑'),
              h('button', { type: 'button', className: 'rsa-icon-button', title: t('moveDown'), 'aria-label': t('moveDown'), disabled: !writable || saving || index === rows.length - 1, onClick: () => { moveTier(index, 1) } }, '↓'),
              h('button', { type: 'button', className: 'rsa-icon-button', title: t('duplicate'), 'aria-label': t('duplicate'), disabled: !writable || saving, onClick: () => { duplicateTier(row) } }, '⧉'),
              h('button', { type: 'button', className: 'rsa-icon-button', title: t('remove'), 'aria-label': t('remove'), disabled: !writable || saving, onClick: () => { removeTier(row.id) } }, '×'),
            ),
            h('div', { className: 'rsa-grid' },
              h(Field, { id: `${prefix}-provider`, label: t('provider'), hint: t('providerHint'), error: providerError },
                h('select', {
                  id: `${prefix}-provider`,
                  className: 'rsa-input rsa-select',
                  value: row.provider,
                  disabled: !writable || saving || catalog.groups.length === 0,
                  ...(providerError === undefined ? {} : { 'aria-invalid': true, 'aria-describedby': `${prefix}-provider-error` }),
                  onChange: (event: { target: { value: string } }) => { updateRow(row.id, providerDefaults(catalog.groups, event.target.value)) },
                },
                row.provider === '' ? h('option', { value: '', disabled: true }, t('selectProvider')) : null,
                group === undefined && row.provider !== '' ? h('option', { value: row.provider }, `${row.provider} — ${t('currentValue')}`) : null,
                catalog.groups.map(candidate => h('option', { key: candidate.id, value: candidate.id },
                  candidate.name === candidate.id ? candidate.id : `${candidate.name} (${candidate.id})`,
                )),
                ),
              ),
              h(Field, { id: `${prefix}-model`, label: t('model'), hint: selectedModel?.description ?? t('modelHint'), error: modelError },
                h('select', {
                  id: `${prefix}-model`,
                  className: 'rsa-input rsa-select',
                  value: row.model,
                  disabled: !writable || saving || group === undefined || group.models.length === 0,
                  ...(modelError === undefined ? {} : { 'aria-invalid': true, 'aria-describedby': `${prefix}-model-error` }),
                  onChange: (event: { target: { value: string } }) => { updateRow(row.id, modelDefaults(catalog.groups, row.provider, event.target.value)) },
                },
                row.model === '' ? h('option', { value: '', disabled: true }, t('selectModel')) : null,
                selectedModel === undefined && row.model !== '' ? h('option', { value: row.model }, `${row.model} — ${t('currentValue')}`) : null,
                (group?.models ?? []).map(candidate => h('option', { key: candidate.id, value: candidate.id },
                  candidate.name === candidate.id ? candidate.id : `${candidate.name} (${candidate.id})`,
                )),
                ),
              ),
              h(Field, { id: `${prefix}-tokens`, label: t('maxTokens'), optional: t('optional'), error: maxTokensError },
                h('input', { ...inputProps(`${prefix}-tokens`, row.maxTokens, !writable || saving, maxTokensError, value => { updateRow(row.id, { maxTokens: value }) }), inputMode: 'numeric', placeholder: '16384' }),
              ),
              h(Field, { id: `${prefix}-effort`, label: t('reasoningEffort'), optional: t('optional'), hint: t('reasoningHint') },
                h('select', {
                  id: `${prefix}-effort`,
                  className: 'rsa-input rsa-select',
                  value: row.reasoningEffort,
                  disabled: !writable || saving || selectedModel?.reasoning === undefined,
                  onChange: (event: { target: { value: string } }) => { updateRow(row.id, { reasoningEffort: event.target.value }) },
                },
                selectedModel?.reasoning === undefined
                  ? h('option', { value: row.reasoningEffort }, row.reasoningEffort || t('noReasoning'))
                  : [
                      h('option', { key: 'provider-default', value: '' }, defaultEffortLabel),
                      row.reasoningEffort !== '' && !efforts.some(effort => effort.id === row.reasoningEffort)
                        ? h('option', { key: 'current', value: row.reasoningEffort }, `${row.reasoningEffort} — ${t('currentValue')}`)
                        : null,
                      ...efforts.map(effort => h('option', { key: effort.id, value: effort.id }, effort.name)),
                    ],
                ),
              ),
              h(Field, { id: `${prefix}-persona`, label: t('persona'), optional: t('optional'), wide: true },
                h('input', { ...inputProps(`${prefix}-persona`, row.persona, !writable || saving, undefined, value => { updateRow(row.id, { persona: value }) }) }),
              ),
              h(Field, { id: `${prefix}-guidance`, label: t('guidance'), optional: t('optional'), hint: t('guidanceHint'), wide: true },
                h('textarea', { id: `${prefix}-guidance`, className: 'rsa-textarea', value: row.guidance, disabled: !writable || saving, placeholder: t('guidancePlaceholder'), onChange: (event: { target: { value: string } }) => { updateRow(row.id, { guidance: event.target.value }) } }),
              ),
              h(Field, { id: `${prefix}-spawnable`, label: t('spawnable'), optional: t('optional'), hint: t('spawnableHint'), error: spawnableError, wide: true },
                h('div', { id: `${prefix}-spawnable`, className: 'rsa-chips' }, rows.map((target, targetIndex) => h('button', {
                  type: 'button',
                  key: target.id,
                  className: 'rsa-chip',
                  'data-selected': String(row.spawnableIds.includes(target.id)),
                  'aria-pressed': row.spawnableIds.includes(target.id),
                  disabled: !writable || saving,
                  onClick: () => { toggleSpawnable(row, target.id) },
                }, target.name.trim() || `${t('unnamedTier')} ${targetIndex + 1}`))),
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
    }, () => h(TiersCard, { t, scope, api })))
  })
}
