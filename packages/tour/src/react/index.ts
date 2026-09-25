/**
 * `@toolmark/tour/react` — React binding for headless tours (spec §11.5).
 * @packageDocumentation
 * @module @toolmark/tour/react
 */
import { useCallback, useSyncExternalStore } from 'react'
import type { Tour, TourState } from '../types.js'

const noop = (): void => {}
const serverSnapshot = (): null => null

/**
 * Subscribes to a tour's state for a custom (headless) UI. Re-renders on every state change;
 * `null` while there is no tour and during server rendering.
 * @param tour - The tour from `startTour`, or `null`.
 * @returns The current {@link TourState}, or `null`.
 * @example
 * ```tsx
 * const state = useTour(tour)
 * if (state?.status === 'running') return <Callout anchor={state.anchor} step={state.steps[state.index]} />
 * ```
 */
export function useTour(tour: Tour | null): TourState | null {
  const subscribe = useCallback((cb: () => void) => (tour ? tour.subscribe(cb) : noop), [tour])
  const getSnapshot = useCallback(() => (tour ? tour.state : null), [tour])
  return useSyncExternalStore(subscribe, getSnapshot, serverSnapshot)
}
