import type { Caller, ToolResult } from '@toolmark/core'
import type { TourMode, TourStep } from '@toolmark/tour'

/** One registry `result` event, as logged for the e2e specs. */
export interface ExampleResult {
  caller: Caller
  tool: string
  result: ToolResult<unknown>
}

/**
 * Test-only page globals of the example (installed outside production builds, next to the
 * Toolmark test hook).
 */
export interface ExampleHook {
  /** This page load's registry `clientId` (addresses bridge messages on a shared relay). */
  clientId: string
  /** Every registry `result` event since the page loaded, in order. */
  results: ExampleResult[]
  /**
   * Starts an authored tour through the tour panel (overlay and event log included); resolves once
   * the tour is on its first step. Set while the tour panel is mounted.
   */
  startTour?: (o: { mode: TourMode; steps: TourStep[] }) => Promise<void>
}

declare global {
  /** Test-only: the example's e2e globals (see {@link ExampleHook}). */
  var __example: ExampleHook | undefined
}
