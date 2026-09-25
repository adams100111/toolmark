import type { RouteFn } from '@toolmark/inertia'
import { create as challengesCreate, index as challengesIndex } from '@/routes/challenges'
import { show as feedbackShow } from '@/routes/feedback'
import { show as wizardShow } from '@/routes/wizard'

/** GET routes the `navigate` tool may visit (Wayfinder route functions return `{ url, method }`). */
export const routes: Record<string, RouteFn> = {
  'challenges.index': () => challengesIndex(),
  'challenges.create': () => challengesCreate(),
  'wizard.show': () => wizardShow(),
  'feedback.show': () => feedbackShow(),
}
