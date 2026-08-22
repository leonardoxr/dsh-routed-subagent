import { describe, expect, it } from 'vitest'
import { allowedTiersFor, parseTierTable, rootTierNames } from '../src/tiers.ts'

const table = parseTierTable({
  fast: { provider: 'openai-codex', model: 'gpt-5.4-mini', spawnable: [] },
  deep: { provider: 'openai-codex', model: 'gpt-5.6-sol', spawnable: ['fast'] },
  cheap: { provider: 'openai-codex', model: 'gpt-5.6-luna' },
})

describe('parseTierTable', () => {
  it('accepts a valid table and defaults spawnable to none', () => {
    expect(table.fast?.spawnable).toEqual([])
    expect(table.deep?.model).toBe('gpt-5.6-sol')
  })

  it('fails loud on absent, empty, or malformed tables', () => {
    expect(() => parseTierTable(undefined)).toThrow(/non-empty mapping/)
    expect(() => parseTierTable({})).toThrow(/non-empty mapping/)
    expect(() => parseTierTable({ x: { provider: 'p' } })).toThrow(/"x".*model/)
    expect(() => parseTierTable({ x: { provider: '', model: 'm' } })).toThrow(/"x".*provider/)
    expect(() => parseTierTable({ x: { provider: 'p', model: 'm', maxTokens: 0 } })).toThrow(/maxTokens/)
  })

  it('rejects unknown spawn references after the whole table is known', () => {
    expect(() => parseTierTable({
      a: { provider: 'p', model: 'm', spawnable: ['ghost'] },
    })).toThrow(/"a" spawns unknown tier "ghost"/)
  })
})

describe('rootTierNames', () => {
  it('defaults to every configured tier in table order', () => {
    expect(rootTierNames(table, undefined)).toEqual(['fast', 'deep', 'cheap'])
  })

  it('honors an explicit allowlist and rejects unknown names', () => {
    expect(rootTierNames(table, ['deep'])).toEqual(['deep'])
    expect(() => rootTierNames(table, ['nope'])).toThrow(/unknown tier "nope"/)
  })
})

describe('allowedTiersFor', () => {
  const roots = rootTierNames(table, undefined)

  it('gives top-level callers the root menu', () => {
    expect(allowedTiersFor(table, roots, undefined)).toEqual(['fast', 'deep', 'cheap'])
  })

  it('narrows spawned children to their tier spawn chain', () => {
    expect(allowedTiersFor(table, roots, 'deep')).toEqual(['fast'])
    expect(allowedTiersFor(table, roots, 'fast')).toEqual([])
  })

  it('denies unknown tracked contexts instead of guessing', () => {
    expect(allowedTiersFor(table, roots, 'stale')).toEqual([])
  })
})
