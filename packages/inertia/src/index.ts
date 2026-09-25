/**
 * `@toolmark/inertia` — Inertia.js adapter for Toolmark: `useForm` form tools, page-scoped
 * server-declared tools and navigation.
 * @packageDocumentation
 */
export type { InertiaFormLike } from './inertia-adapter.js'
export { inertiaAdapter } from './inertia-adapter.js'
export type { InertiaVisitCallbacks } from './visit-outcome.js'
export type {
  InertiaCommonEventName,
  InertiaEventName,
  RouterLike,
  RouterVisitOptions,
  VisitDataValue,
} from './router-like.js'
export type { InertiaPagesOptions } from './pages.js'
export { inertiaPages } from './pages.js'
export type { PropsToolEntry, PropsToolMethod, PropsToolsOptions } from './props-tools.js'
export { propsTools } from './props-tools.js'
export type { NavigationInput, NavigationToolOptions, RouteFn } from './navigation.js'
export { navigationTool } from './navigation.js'
