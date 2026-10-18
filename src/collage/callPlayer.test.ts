// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { stopCall, toggleCall, useCallPlayback } from './callPlayer.ts'

afterEach(() => {
  act(() => stopCall())
  vi.restoreAllMocks()
})

describe('call playback ownership', () => {
  it('does not stop another recording when an old card leaves', () => {
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue()
    const pause = vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {})
    const { result } = renderHook(() => useCallPlayback())
    act(() => toggleCall('/new.mp3'))
    act(() => stopCall('/old.mp3'))
    expect(pause).not.toHaveBeenCalled()
    expect(result.current).toEqual({ url: '/new.mp3', state: 'loading' })
    act(() => stopCall('/new.mp3'))
    expect(pause).toHaveBeenCalledOnce()
    expect(result.current).toEqual({ url: null, state: 'idle' })
  })

  it('ignores a canceled play promise after a replacement starts', async () => {
    let rejectOld: (error: Error) => void = () => {}
    vi.spyOn(HTMLMediaElement.prototype, 'play')
      .mockImplementationOnce(
        () =>
          new Promise<void>((_resolve, reject) => {
            rejectOld = reject
          }),
      )
      .mockResolvedValue()
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {})
    const { result } = renderHook(() => useCallPlayback())
    act(() => toggleCall('/old.mp3'))
    act(() => stopCall('/old.mp3'))
    act(() => toggleCall('/new.mp3'))
    await act(async () => rejectOld(new Error('play interrupted by pause')))
    expect(result.current).toEqual({ url: '/new.mp3', state: 'loading' })
  })

  it('keeps a stopped pending request idle when its promise rejects', async () => {
    let rejectPlay: (error: Error) => void = () => {}
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementationOnce(
      () =>
        new Promise<void>((_resolve, reject) => {
          rejectPlay = reject
        }),
    )
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {})
    const { result } = renderHook(() => useCallPlayback())
    act(() => toggleCall('/old.mp3'))
    act(() => stopCall('/old.mp3'))
    await act(async () => rejectPlay(new Error('play interrupted by pause')))
    expect(result.current).toEqual({ url: null, state: 'idle' })
  })
})
