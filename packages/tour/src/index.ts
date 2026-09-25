/**
 * `@toolmark/tour` — framework-free guided tours over the registry's tools, anchors, state and
 * interaction events (spec §11.5). The overlay lives in `@toolmark/tour/overlay`, the React binding
 * in `@toolmark/tour/react`.
 * @packageDocumentation
 * @module @toolmark/tour
 */
export type {
  Planner,
  PlannerContext,
  StartTourOptions,
  Tour,
  TourEvent,
  TourMode,
  TourState,
  TourStep,
} from './types.js'
export { startTour } from './engine.js'
