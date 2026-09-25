/** A named group of tools; its path prefixes every tool name registered into it. */
export interface Scope {
  /** Dot path (the root scope is `""`). */
  readonly path: string
  /**
   * Creates a child scope.
   * @param name - Child name; the child's path is `<path>.<name>`.
   * @param opts - `when: false` hides the child's tools until `setWhen(true)`.
   */
  scope(name: string, opts?: { when?: boolean }): Scope
  /** Shows (`true`) or hides (`false`) this scope's tools, including descendants'. */
  setWhen(v: boolean): void
  /** Disposes the scope, its descendants and every tool registered in them. */
  dispose(): void
  /** Whether the scope has been disposed. */
  readonly disposed: boolean
}

/** @internal Hooks the registry installs on every scope node. */
export interface ScopeHooks {
  /** `false` under SSR: child scopes are detached (never added to `children`), m6. */
  readonly attach: boolean
  onWhenChange(node: ScopeNode): void
  onDispose(node: ScopeNode): void
}

/** @internal Registry-owned scope implementation. */
export class ScopeNode implements Scope {
  readonly path: string
  readonly parent: ScopeNode | null
  readonly children = new Set<ScopeNode>()
  when: boolean
  #disposed = false
  readonly #hooks: ScopeHooks

  constructor(path: string, parent: ScopeNode | null, when: boolean, hooks: ScopeHooks) {
    this.path = path
    this.parent = parent
    this.when = when
    this.#hooks = hooks
  }

  get disposed(): boolean {
    return this.#disposed
  }

  scope(name: string, opts?: { when?: boolean }): Scope {
    const path = this.path === '' ? name : `${this.path}.${name}`
    const child = new ScopeNode(path, this, opts?.when ?? true, this.#hooks)
    if (this.#disposed) child.#disposed = true
    // Under SSR the registry is inert: a detached child keeps no reference from its parent, so a
    // long-lived server registry does not accumulate one node per render.
    else if (this.#hooks.attach) this.children.add(child)
    return child
  }

  setWhen(v: boolean): void {
    if (this.#disposed || this.when === v) return
    this.when = v
    this.#hooks.onWhenChange(this)
  }

  dispose(): void {
    if (this.#disposed) return
    for (const child of [...this.children]) child.dispose()
    this.#disposed = true
    this.parent?.children.delete(this)
    this.#hooks.onDispose(this)
  }

  /** Whether this scope and every ancestor have `when !== false`. */
  isShown(): boolean {
    return this.when && (this.parent?.isShown() ?? true)
  }

  /** The root scope of this node's registry. */
  root(): ScopeNode {
    return this.parent ? this.parent.root() : this
  }

  /** Whether `this` is `node` or one of its descendants. */
  isWithin(node: ScopeNode): boolean {
    return this === node || (this.parent?.isWithin(node) ?? false)
  }
}
