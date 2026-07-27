// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useDelayedFlag } from './useDelayedFlag.ts'

describe('useDelayedFlag', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('stays false until the delay has elapsed', () => {
    const { result } = renderHook(() => useDelayedFlag(true, 1000))

    expect(result.current).toBe(false)
    act(() => {
      vi.advanceTimersByTime(999)
    })
    expect(result.current).toBe(false)
    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(result.current).toBe(true)
  })

  it('never turns true when active clears before the delay', () => {
    const { result, rerender } = renderHook(({ active }) => useDelayedFlag(active, 1000), {
      initialProps: { active: true },
    })

    act(() => {
      vi.advanceTimersByTime(500)
    })
    rerender({ active: false })
    act(() => {
      vi.advanceTimersByTime(1000)
    })
    expect(result.current).toBe(false)
  })

  it('resets to false once active goes false', () => {
    const { result, rerender } = renderHook(({ active }) => useDelayedFlag(active, 1000), {
      initialProps: { active: true },
    })

    act(() => {
      vi.advanceTimersByTime(1000)
    })
    expect(result.current).toBe(true)
    rerender({ active: false })
    expect(result.current).toBe(false)
  })
})
