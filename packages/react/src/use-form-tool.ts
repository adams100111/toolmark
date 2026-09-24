import { useEffect, useMemo, useRef } from 'react'
import { createFormTools, type FormAdapter, type FormToolOptions } from '@toolmark/core'
import { useCurrentScope } from './scope.js'
import { useToolmark } from './provider.js'

/** Shallow key of `sensitive`, for change detection independent of array identity. */
function sensitiveKey(sensitive: string[] | undefined): string {
  return sensitive ? sensitive.join('\u0000') : ''
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
  const stableAdapter = useMemo<FormAdapter<V>>(
    () => ({
      getValues: () => adapterRef.current.getValues(),
      setValues: (values, o) => adapterRef.current.setValues(values, o),
      dirtyPaths: () => adapterRef.current.dirtyPaths(),
      submit: () => adapterRef.current.submit(),
      fields: () => adapterRef.current.fields(),
    }),
    [],
  )

  const skey = sensitiveKey(opts.sensitive)

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
      ...(current.submitSummary !== undefined
        ? { submitSummary: (values: V) => optsRef.current.submitSummary?.(values) ?? '' }
        : {}),
      ...(scope ? { scope } : {}),
    })
    return () => handle.dispose()
  }, [toolmark, scope, opts.name, opts.description, opts.title, opts.input, opts.jsonSchema, skey, stableAdapter])
}
