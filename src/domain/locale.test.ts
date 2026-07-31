import { describe, expect, it } from 'vitest'
import { pickDictionaryLocale, reduceToDictLocale, SUPPORTED_DICT_LOCALES } from './locale.ts'

const ALL = SUPPORTED_DICT_LOCALES

describe('reduceToDictLocale', () => {
  it('reduces region variants to their base language', () => {
    expect(reduceToDictLocale('de-DE', ALL)).toBe('de')
    expect(reduceToDictLocale('pt-BR', ALL)).toBe('pt')
    expect(reduceToDictLocale('en-US', ALL)).toBe('en')
  })

  it('is case-insensitive', () => {
    expect(reduceToDictLocale('DE', ALL)).toBe('de')
    expect(reduceToDictLocale('Pt-br', ALL)).toBe('pt')
  })

  it('folds Norwegian macrolanguage/Nynorsk onto nb', () => {
    expect(reduceToDictLocale('no', ALL)).toBe('nb')
    expect(reduceToDictLocale('nn', ALL)).toBe('nb')
    expect(reduceToDictLocale('nb-NO', ALL)).toBe('nb')
  })

  it('returns null for languages outside the dictionary set', () => {
    expect(reduceToDictLocale('ja', ALL)).toBeNull()
    expect(reduceToDictLocale('zh-Hant', ALL)).toBeNull()
    expect(reduceToDictLocale('', ALL)).toBeNull()
  })

  it('respects the available subset, not just the full set', () => {
    expect(reduceToDictLocale('de-DE', ['nl', 'en'])).toBeNull()
    expect(reduceToDictLocale('nl-BE', ['nl', 'en'])).toBe('nl')
  })
})

describe('pickDictionaryLocale', () => {
  it('returns the first browser language that maps to an available locale', () => {
    expect(pickDictionaryLocale(['ja', 'de-DE', 'fr'], ALL)).toBe('de')
  })

  it('skips unavailable languages in preference order', () => {
    expect(pickDictionaryLocale(['ja', 'zh', 'nl'], ['nl', 'en'])).toBe('nl')
  })

  it('returns null when nothing matches or the list is empty', () => {
    expect(pickDictionaryLocale(['ja', 'zh'], ALL)).toBeNull()
    expect(pickDictionaryLocale([], ALL)).toBeNull()
  })
})
