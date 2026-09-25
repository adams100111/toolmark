import { useContext, useEffect, useReducer, useRef, type JSX, type ReactNode } from 'react'
import type { Scope } from '@toolmark/core'
import { ScopeContext } from './context.js'
import { isServerEnvironment } from './is-server.js'
import { useToolmark } from './provider.js'

/** Props for {@link ToolScope}. */
export interface ToolScopeProps {
  /** Child scope name; the full path is the enclosing scope's path + `.` + `name`. */
  name: string
  /** Shows (`true`, the default) or hides this scope's tools. */
  when?: boolean
  /** Subtree whose `useTool`/`useFormTool` calls register into this scope. */
  children?: ReactNode
}

/**
 * Groups tools registered by its subtree under one named scope (spec §5).
 *
 * The scope is created lazily, during render, into a ref: children mount (and register their
 * tools) before `ToolScope`'s own effect runs, so the scope must already exist by then. The
 * mount effect disposes the scope on cleanup and clears the ref; if a later mount effect finds
 * the ref empty (a React StrictMode remount, whose cleanup already ran) it re-creates the scope
 * and forces one more render so the subtree re-registers into the live scope.
 *
 * Under SSR (`renderToString`/`renderToStaticMarkup`, no `document`) effects never run, so nothing
 * would ever dispose a scope created during render, so this skips creating one server-side and
 * provides `undefined` instead (core's server-side `Scope.scope()` also returns a detached node,
 * so a repeated `renderToString` against one module-level registry never accumulates child
 * scopes).
 *
 * Known limit: a render React discards before commit (a suspended or interrupted concurrent render)
 * may leave the scope it created behind. Such a node is empty — its children never mounted, so no
 * tool is registered in it — and stays attached to its parent until the parent is disposed.
 * @param props - See {@link ToolScopeProps}.
 */
export function ToolScope(props: ToolScopeProps): JSX.Element {
  const toolmark = useToolmark()
  const parent = useContext(ScopeContext)
  const scopeRef = useRef<Scope | null>(null)
  const [, bump] = useReducer((n: number) => n + 1, 0)
  const when = props.when ?? true
  const isServer = isServerEnvironment()

  if (scopeRef.current === null && !isServer) {
    scopeRef.current = (parent ?? toolmark).scope(props.name, { when })
  }

  useEffect(() => {
    if (scopeRef.current === null) {
      scopeRef.current = (parent ?? toolmark).scope(props.name, { when: props.when ?? true })
      bump()
    }
    return () => {
      scopeRef.current?.dispose()
      scopeRef.current = null
    }
    // Re-creation of the scope is driven by identity of the enclosing registry/scope and this
    // scope's own name; `when` is applied by the effect below.
  }, [toolmark, parent, props.name])

  useEffect(() => {
    scopeRef.current?.setWhen(props.when ?? true)
  }, [props.when])

  return (
    <ScopeContext.Provider value={scopeRef.current ?? undefined}>
      {props.children}
    </ScopeContext.Provider>
  )
}

/** The current {@link Scope}, or `undefined` at the registry root (outside any `<ToolScope>`). */
export function useCurrentScope(): Scope | undefined {
  return useContext(ScopeContext)
}
