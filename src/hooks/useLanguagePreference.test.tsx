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

  it('falls back to the station default when the browser language is not published', () => {
    setLanguages(['ja'])
    const { result } = renderHook(() => useLanguagePreference(['de', 'nl'], 'nl'))
    expect(result.current.lang).toBe('nl')
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

  it('is null when nothing is published', () => {
    setLanguages(['de-DE'])
    const { result } = renderHook(() => useLanguagePreference([], null))
    expect(result.current.lang).toBeNull()
  })
})
