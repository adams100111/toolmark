/**
 * @internal Whether this code is running without a DOM (SSR — `renderToString` /
 * `renderToStaticMarkup`). A separate module so tests can substitute it directly (a real browser
 * global's `document` cannot be undefined/redefined the way a true server runtime's can).
 */
export function isServerEnvironment(): boolean {
  return typeof document === 'undefined'
}
