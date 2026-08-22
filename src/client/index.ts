/**
 * dsh-routed-subagent browser half — the plugin's card inside
 * Settings → Plugins → configurable plugins, editing the tier table through
 * the client settings scope (staged draft → explicit replace, reset to
 * composition). Structural host typing only: no monorepo-internal imports,
 * so this bundle builds against published packages alone.
 */
import { createElement as h, useState } from 'react'

/** Namespace of the routed subagent's user-owned tier table (Host-registered). */
const NS = 'routed-subagent'

/** The subset of the settings scope this card drives. */
interface BoundScope {
  /** Current resolved section: schema defaults, then composition, then user layer. */
  getSnapshot(): {
    value: { tiers?: unknown } | undefined
  }
  /** Write one user-layer field. */
  set(field: string, value: unknown): Promise<void>
  /** Clear one user-layer field so it re-inherits composition. */
  unset(field: string): Promise<void>
}

/** Serialize the currently resolved tier table for the editor. */
export function tierDraft(scope: BoundScope): string {
  return JSON.stringify({ tiers: scope.getSnapshot().value?.tiers ?? {} }, null, 2)
}

/** Validate and persist one editor draft through the public client scope API. */
export async function saveTierDraft(scope: BoundScope, draft: string): Promise<boolean> {
  let parsed: unknown
  try {
    parsed = JSON.parse(draft)
  } catch {
    return false
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed) || !Object.hasOwn(parsed, 'tiers')) return false
  await scope.set('tiers', (parsed as { tiers: unknown }).tiers)
  return true
}

/** Clear the tier override so composition supplies it again. */
export async function resetTierDraft(scope: BoundScope): Promise<void> {
  await scope.unset('tiers')
}

/** The client cordis context shape this plugin relies on. */
interface RoutedClientContext {
  effect(callback: () => unknown, label?: string): void
  locale: {
    register(namespace: string, dicts: { zh: Record<string, string>; en: Record<string, string> }): unknown
    bind(namespace: string): (key: string) => string
  }
  slots: {
    inject(slot: string, register: () => unknown): void
    register(meta: Record<string, unknown>, component: () => unknown): unknown
  }
}

/** Labels for one locale. */
type Dict = Record<string, string>

const en: Dict = {
  title: 'Routed subagent',
  description: 'Runtime tiers the model may pick when delegating. Saved edits apply to new delegations immediately; toolName, provider name, and depth stay in composition.',
  save: 'Save',
  reload: 'Reload',
  resetToComposition: 'Reset to composition',
  invalidJson: 'Not valid JSON',
  saved: 'Saved.',
  saveFailed: 'Save refused by the Host: ',
}

const zh: Dict = {
  title: '路由子代理',
  description: '模型委派任务时可选择的运行时层级。保存后对新委派立即生效；toolName、provider 与深度仍在组合层配置。',
  save: '保存',
  reload: '重新加载',
  resetToComposition: '恢复为组合配置',
  invalidJson: 'JSON 格式不正确',
  saved: '已保存。',
  saveFailed: '宿主拒绝了保存：',
}

/** Props the slot registration hands the card component. */
interface TiersCardProps {
  t: (key: string) => string
  scope: BoundScope
}

/**
 * The tiers editor: one staged JSON draft over the section's `tiers` mapping.
 * A textarea is deliberate for v1 — the table is a free-form mapping of named
 * runtime profiles, and fake structure would constrain it. Validation stays
 * Host-side on save (the section validator refuses invalid tables).
 */
function TiersCard(props: TiersCardProps) {
  const { t, scope } = props
  const [draft, setDraft] = useState(() => tierDraft(scope))
  const [status, setStatus] = useState('')

  const save = async (): Promise<void> => {
    try {
      if (!await saveTierDraft(scope, draft)) {
        setStatus(t('invalidJson'))
        return
      }
      setDraft(tierDraft(scope))
      setStatus(t('saved'))
    } catch (reason) {
      setStatus(t('saveFailed') + String(reason instanceof Error ? reason.message : reason))
    }
  }

  const reload = (): void => {
    setDraft(tierDraft(scope))
    setStatus('')
  }

  const reset = async (): Promise<void> => {
    try {
      await resetTierDraft(scope)
      setDraft(tierDraft(scope))
      setStatus('')
    } catch (reason) {
      setStatus(String(reason))
    }
  }

  return h('div', { style: CARD_STYLE },
    h('label', { style: LABEL_STYLE }, t('title')),
    h('p', { style: HINT_STYLE }, t('description')),
    h('textarea', {
      value: draft,
      rows: 14,
      spellCheck: false,
      style: TEXTAREA_STYLE,
      onChange: (event: { target: { value: string } }) => { setDraft(event.target.value); setStatus('') },
    }),
    h('div', { style: ROW_STYLE },
      h('button', { style: BUTTON_STYLE, onClick: () => { void save() } }, t('save')),
      h('button', { style: BUTTON_STYLE, onClick: reload }, t('reload')),
      h('button', { style: BUTTON_STYLE, onClick: () => { void reset() } }, t('resetToComposition')),
    ),
    status === '' ? null : h('div', { style: STATUS_STYLE }, status),
  )
}

const CARD_STYLE: Record<string, string> = { display: 'flex', flexDirection: 'column', gap: '8px' }
const LABEL_STYLE: Record<string, string> = { fontWeight: 600 }
const HINT_STYLE: Record<string, string> = { opacity: 0.75, margin: '0' }
const TEXTAREA_STYLE: Record<string, string> = { fontFamily: 'monospace', fontSize: '12px', width: '100%', resize: 'vertical' }
const ROW_STYLE: Record<string, string> = { display: 'flex', gap: '8px' }
const BUTTON_STYLE: Record<string, string> = { cursor: 'pointer' }
const STATUS_STYLE: Record<string, string> = { fontSize: '12px', opacity: 0.85 }

export const name = 'routed-subagent'
export const inject = ['slots', 'locale']

/**
 * Mount the browser half: dictionaries plus the keyed card into
 * `settings.plugin.item`. The settingsScope injection is nested so a host
 * without the plugin-configuration page simply never renders the card.
 * @param ctx - the browser plugin context.
 */
export function apply(ctx: RoutedClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'routed-subagent: card dictionaries')
  const t = ctx.locale.bind(NS)

  const settingsCtx = ctx as unknown as {
    inject(services: string[], callback: (scoped: { settingsScope: { bind(options: { namespace: string }): BoundScope } }) => void): void
  }
  settingsCtx.inject(['settingsScope'], (scoped) => {
    const scope = scoped.settingsScope.bind({ namespace: NS })
    scoped.slots.inject('settings.plugin.item', () => scoped.slots.register({
      name: 'settings.plugin.item',
      key: NS,
      locale: NS,
      inject: () => ({ t }),
    }, () => h(TiersCard, { t, scope })))
  })
}
