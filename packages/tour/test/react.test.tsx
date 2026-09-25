import { act, cleanup, render, screen } from '@testing-library/react'
import type { JSX } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import type { Tour, TourState } from '../src/index.js'
import { useTour } from '../src/react/index.js'

afterEach(cleanup)

function fakeTour(): Tour & { set(p: Partial<TourState>): void; listeners(): number } {
  let state: TourState = Object.freeze({
    status: 'running',
    mode: 'show',
    index: 0,
    steps: [
      { tool: 'a', text: 'First' },
      { tool: 'b', text: 'Second' },
    ],
    anchor: null,
    highlight: null,
    busy: false,
  } satisfies TourState)
  const subs = new Set<(s: TourState) => void>()
  return {
    get state() {
      return state
    },
    set(p) {
      state = Object.freeze({ ...state, ...p })
      for (const fn of subs) fn(state)
    },
    listeners: () => subs.size,
    next: () => Promise.resolve(),
    back: () => {},
    stop: () => {},
    subscribe(fn) {
      subs.add(fn)
      return () => subs.delete(fn)
    },
    on: () => () => {},
  }
}

function Panel({ tour }: { tour: Tour | null }): JSX.Element {
  const s = useTour(tour)
  if (!s) return <p>no tour</p>
  return (
    <p>
      {s.status}:{s.index}:{s.steps[s.index]?.text}
    </p>
  )
}

describe('useTour', () => {
  it('use_tour_headless_state', () => {
    const tour = fakeTour()
    const { rerender, unmount } = render(<Panel tour={null} />)
    expect(screen.getByText('no tour')).toBeTruthy()

    rerender(<Panel tour={tour} />)
    expect(screen.getByText('running:0:First')).toBeTruthy()
    expect(tour.listeners()).toBe(1)

    act(() => tour.set({ index: 1 }))
    expect(screen.getByText('running:1:Second')).toBeTruthy()
    act(() => tour.set({ status: 'done' }))
    expect(screen.getByText('done:1:Second')).toBeTruthy()

    rerender(<Panel tour={null} />)
    expect(screen.getByText('no tour')).toBeTruthy()
    expect(tour.listeners()).toBe(0)
    unmount()
  })
})
