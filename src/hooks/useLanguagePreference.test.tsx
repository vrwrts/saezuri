// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { useLanguagePreference } from './useLanguagePreference.ts'

function setLanguages(langs: string[]) {
  Object.defineProperty(navigator, 'languages', { value: langs, configurable: true })
}

beforeEach(() => localStorage.clear())
afterEach(() => localStorage.clear())

describe('useLanguagePreference', () => {
  it('preselects the browser language when it is published', () => {
    setLanguages(['de-DE', 'en'])
    const { result } = renderHook(() => useLanguagePreference(['de', 'nl', 'en'], null))
    expect(result.current.lang).toBe('de')
  })

  it('falls back to station names when the browser language is not published', () => {
    setLanguages(['ja'])
    const { result } = renderHook(() => useLanguagePreference(['de', 'nl'], 'nl'))
    expect(result.current.lang).toBe('station')
  })

  it('honors a remembered choice over the browser and default', () => {
    localStorage.setItem('saezuri:lang', 'nl')
    setLanguages(['de-DE'])
    const { result } = renderHook(() => useLanguagePreference(['de', 'nl'], 'de'))
    expect(result.current.lang).toBe('nl')
  })

  it('persists the choice and updates lang', () => {
    setLanguages(['de-DE'])
    const { result } = renderHook(() => useLanguagePreference(['de', 'nl'], null))
    act(() => result.current.setLang('nl'))
    expect(result.current.lang).toBe('nl')
    expect(localStorage.getItem('saezuri:lang')).toBe('nl')
  })

  it('uses station names when nothing is published', () => {
    setLanguages(['de-DE'])
    const { result } = renderHook(() => useLanguagePreference([], null))
    expect(result.current.lang).toBe('station')
  })

  it('remembers the explicit station language choice', () => {
    localStorage.setItem('saezuri:lang', 'station')
    setLanguages(['de-DE'])

    const { result } = renderHook(() => useLanguagePreference(['de', 'nl'], 'de'))

    expect(result.current.lang).toBe('station')
  })

  it('persists station language when selected', () => {
    setLanguages(['de-DE'])

    const { result } = renderHook(() => useLanguagePreference(['de', 'nl'], 'de'))

    act(() => result.current.setLang('station'))

    expect(result.current.lang).toBe('station')
    expect(localStorage.getItem('saezuri:lang')).toBe('station')
  })

  it('keeps station language when dictionary availability changes', () => {
    localStorage.setItem('saezuri:lang', 'station')
    setLanguages(['de-DE'])

    const { result, rerender } = renderHook(
      ({ locales }: { locales: ('de' | 'nl')[] }) => useLanguagePreference(locales, 'de'),
      { initialProps: { locales: [] as ('de' | 'nl')[] } },
    )

    expect(result.current.lang).toBe('station')

    rerender({ locales: ['de', 'nl'] })

    expect(result.current.lang).toBe('station')
  })

  it('selects the browser dictionary when it arrives asynchronously', () => {
    setLanguages(['de-DE'])
    const { result, rerender } = renderHook(
      ({ locales }: { locales: ('de' | 'nl')[] }) => useLanguagePreference(locales, null),
      { initialProps: { locales: [] as ('de' | 'nl')[] } },
    )
    expect(result.current.lang).toBe('station')
    rerender({ locales: ['de', 'nl'] })
    expect(result.current.lang).toBe('de')
  })

  it('restores a saved dictionary choice when it arrives asynchronously', () => {
    localStorage.setItem('saezuri:lang', 'nl')
    setLanguages(['de-DE'])
    const { result, rerender } = renderHook(
      ({ locales }: { locales: ('de' | 'nl')[] }) => useLanguagePreference(locales, null),
      { initialProps: { locales: [] as ('de' | 'nl')[] } },
    )
    expect(result.current.lang).toBe('station')
    rerender({ locales: ['de', 'nl'] })
    expect(result.current.lang).toBe('nl')
  })

  it('keeps a manual station choice when storage fails and dictionaries arrive', () => {
    setLanguages(['de-DE'])
    const { result, rerender } = renderHook(
      ({ locales }: { locales: ('de' | 'nl')[] }) => useLanguagePreference(locales, null),
      { initialProps: { locales: [] as ('de' | 'nl')[] } },
    )

    expect(result.current.lang).toBe('station')

    const originalSetItem = Storage.prototype.setItem
    Storage.prototype.setItem = () => {
      throw new Error('Storage unavailable')
    }

    try {
      act(() => result.current.setLang('station'))
      rerender({ locales: ['de', 'nl'] })
      expect(result.current.lang).toBe('station')
    } finally {
      Storage.prototype.setItem = originalSetItem
    }
  })

  it('falls back when a manually selected dictionary disappears', () => {
    setLanguages(['de-DE'])
    const { result, rerender } = renderHook(
      ({ locales }: { locales: ('de' | 'nl')[] }) => useLanguagePreference(locales, null),
      { initialProps: { locales: ['de', 'nl'] as ('de' | 'nl')[] } },
    )

    act(() => result.current.setLang('nl'))
    expect(result.current.lang).toBe('nl')

    rerender({ locales: ['de'] })
    expect(result.current.lang).toBe('de')
  })
})
