import { useEffect, useMemo, useRef, type MutableRefObject } from 'react'
import {
  createFormTools,
  type FileFieldSpec,
  type FormAdapter,
  type FormToolOptions,
  type OptionsProvider,
} from '@toolmark/core'
import { useCurrentScope } from './scope.js'
import { useToolmark } from './provider.js'

/** Shallow key of `sensitive`, for change detection independent of array identity. */
function sensitiveKey(sensitive: string[] | undefined): string {
  return sensitive ? sensitive.join('\u0000') : ''
}

/** Content-based key of `options`' field set, for change detection independent of the map's or
 * its providers' identity: only a change in *which* fields declare options should re-register. */
function optionsKey(options: Record<string, OptionsProvider> | undefined): string {
  return options ? Object.keys(options).sort().join('\u0000') : ''
}

/** Content-based key of `files`, for change detection independent of object identity. */
function filesKey(files: Record<string, FileFieldSpec> | undefined): string {
  if (!files) return ''
  return Object.keys(files)
    .sort()
    .map((key) => `${key}:${JSON.stringify(files[key])}`)
    .join('\u0000')
}

/**
 * @internal Wraps `options`' providers so each call looks up the *current* provider (by field key)
 * through `optsRef` instead of closing over the one captured when the wrapper was built — so a
 * fresh provider closure passed on a later render is used without forcing a re-registration. Only
 * rebuilt when the field-key set changes (`optionsKey`).
 */
function wrapOptions<V extends Record<string, unknown>>(
  keys: string[],
  optsRef: MutableRefObject<FormToolOptions<V>>,
): Record<string, OptionsProvider> {
  const wrapped: Record<string, OptionsProvider> = {}
  for (const key of keys) {
    wrapped[key] = (args) => {
      const provider = optsRef.current.options?.[key]
      return provider ? provider(args) : Promise.resolve([])
    }
  }
  return wrapped
}

/**
 * @internal A `FormAdapter` extended with the not-yet-core-typed `onUserInteraction` hook (spec §9,
 * §13; the field lands on {@link FormAdapter} itself in M3 for tour interaction events). Adapters
 * that already carry it (e.g. a DOM/native-form adapter) get it forwarded through the stable proxy
 * below rather than silently dropped, so M3 wiring it up needs no change here.
 */
interface FormAdapterWithInteraction<V extends Record<string, unknown>> extends FormAdapter<V> {
  onUserInteraction?: (...args: never[]) => unknown
}

/**
 * Registers `<name>.fill` and `<name>.submit` for `adapter` (spec §8.1, §9) while the component is
 * mounted.
 *
 * Registration happens in an effect, under the current scope. `adapter` is read through a ref
 * updated on every render, so passing a fresh adapter object each render never forces a
 * re-registration by itself and every call always uses the latest adapter. `submitSummary` is read
 * the same way. The tools re-register only when `name`, `description`, `title`, `sensitive`
 * (compared shallowly) or the `input`/`jsonSchema` identities change.
 * @param adapter - Bridges the form library to the form tools.
 * @param opts - See {@link FormToolOptions}.
 */
export function useFormTool<V extends Record<string, unknown>>(
  adapter: FormAdapter<V>,
  opts: FormToolOptions<V>,
): void {
  const toolmark = useToolmark()
  const scope = useCurrentScope()
  const adapterRef = useRef(adapter)
  adapterRef.current = adapter
  const optsRef = useRef(opts)
  optsRef.current = opts

  // A stable proxy so `createFormTools` always calls the latest adapter/`submitSummary`, without
  // that forcing a re-registration when the caller passes fresh function/object identities.
  const stableAdapter = useMemo<FormAdapter<V>>(() => {
    const proxy: FormAdapterWithInteraction<V> = {
      getValues: () => adapterRef.current.getValues(),
      setValues: (values, o) => adapterRef.current.setValues(values, o),
      dirtyPaths: () => adapterRef.current.dirtyPaths(),
      submit: () => adapterRef.current.submit(),
      fields: () => adapterRef.current.fields(),
    }
    // Forward `onUserInteraction` live (through the ref): the getter always reflects whatever the
    // *latest* adapter carries, `undefined` when it has none.
    Object.defineProperty(proxy, 'onUserInteraction', {
      enumerable: true,
      get: () => (adapterRef.current as FormAdapterWithInteraction<V>).onUserInteraction,
    })
    return proxy
  }, [])

  const skey = sensitiveKey(opts.sensitive)
  const okey = optionsKey(opts.options)
  const fkey = filesKey(opts.files)

  // Rebuilt only when the *set* of option field keys changes: each provider forwards through
  // `optsRef` at call time, so a fresh provider closure every render never forces this to rebuild.
  // `okey` (the field-key set) is this memo's real dependency; `optsRef` is a stable ref object
  // whose `.current` is read fresh inside the callback (no eslint-plugin-react-hooks configured
  // in this repo to silence for the intentionally narrower dependency list).
  const stableOptions = useMemo<Record<string, OptionsProvider> | undefined>(() => {
    const current = optsRef.current.options
    return current ? wrapOptions(Object.keys(current), optsRef) : undefined
  }, [okey])

  useEffect(() => {
    // See `useTool` for why this guard is needed under React StrictMode + `<ToolScope>`.
    if (scope?.disposed) return undefined
    const current = optsRef.current
    const handle = createFormTools(toolmark, stableAdapter, {
      name: current.name,
      description: current.description,
      input: current.input,
      ...(current.title !== undefined ? { title: current.title } : {}),
      ...(current.jsonSchema !== undefined ? { jsonSchema: current.jsonSchema } : {}),
      ...(current.sensitive !== undefined ? { sensitive: current.sensitive } : {}),
      ...(stableOptions !== undefined ? { options: stableOptions } : {}),
      ...(current.files !== undefined ? { files: current.files } : {}),
      ...(current.submitSummary !== undefined
        ? { submitSummary: (values: V) => optsRef.current.submitSummary?.(values) ?? '' }
        : {}),
      ...(scope ? { scope } : {}),
    })
    return () => handle.dispose()
  }, [
    toolmark,
    scope,
    opts.name,
    opts.description,
    opts.title,
    opts.input,
    opts.jsonSchema,
    skey,
    fkey,
    stableOptions,
    opts.submitSummary !== undefined,
    stableAdapter,
  ])
}
