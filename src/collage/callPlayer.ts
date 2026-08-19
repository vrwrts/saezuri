import { useSyncExternalStore } from 'react'

// One <audio> element for the whole app, held at module scope: only one bird
// should ever be singing, so starting a second call must stop the first —
// sharing the element makes that the default rather than something every caller
// has to remember.
//
// Nothing here plays on its own. Playback is only ever reached through an
// explicit press on the species card, which is what keeps an unattended display
// silent and satisfies the browser's autoplay gate for free.

export type PlaybackState = 'idle' | 'loading' | 'playing' | 'error'

export interface Playback {
  url: string | null
  state: PlaybackState
}

const IDLE: Playback = { url: null, state: 'idle' }

let current: Playback = IDLE
let audio: HTMLAudioElement | null = null
const listeners = new Set<() => void>()

function publish(next: Playback): void {
  current = next
  for (const notify of listeners) notify()
}

function subscribe(notify: () => void): () => void {
  listeners.add(notify)
  return () => {
    listeners.delete(notify)
  }
}

/** Lazily construct the shared element, so importing this module never touches
 *  the DOM (it is imported by components rendered under Node in tests). */
function element(): HTMLAudioElement {
  if (audio) return audio
  const el = new Audio()
  el.preload = 'none'
  // Track the *requested* url, not el.src: the browser resolves src to an
  // absolute URL, which would never match the relative path the card holds.
  el.addEventListener('playing', () => publish({ url: current.url, state: 'playing' }))
  el.addEventListener('ended', () => publish(IDLE))
  el.addEventListener('error', () => publish({ url: current.url, state: 'error' }))
  audio = el
  return el
}

export function toggleCall(url: string): void {
  if (current.url === url && current.state !== 'idle') {
    stopCall()
    return
  }
  publish({ url, state: 'loading' })
  try {
    const el = element()
    el.src = url
    // Older Safari returns undefined rather than a promise.
    void el.play()?.catch(() => publish({ url, state: 'error' }))
  } catch {
    publish({ url, state: 'error' })
  }
}

export function stopCall(): void {
  if (audio) {
    audio.pause()
    audio.currentTime = 0
  }
  publish(IDLE)
}

export function useCallPlayback(): Playback {
  return useSyncExternalStore(
    subscribe,
    () => current,
    () => IDLE,
  )
}
