/**
 * `@toolmark/core/dom` — DOM scanning and the DOM form adapter (spec §10.2). The entry has no
 * top-level DOM access, so it imports under Node (SSR).
 * @packageDocumentation
 */
export type { DomFormAdapter, DomFormAdapterOptions } from './form-adapter.js'
export { domFormAdapter } from './form-adapter.js'
export { synthesizeFormSchema } from './synthesize.js'
