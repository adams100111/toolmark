/** Fixture judge: default export is a `Judge` object directly (no factory). */
export default {
  name: 'fixture-object',
  async judge({ page, tools }) {
    return [
      {
        rule: 'judge/fixture',
        severity: 'warn',
        page,
        message: `fixture-object saw ${tools.length} tool(s)`,
      },
    ]
  },
}
