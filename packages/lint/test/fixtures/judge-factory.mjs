/** Fixture judge: default export is a zero-argument factory returning a `Judge`. */
export default function createFixtureJudge() {
  return {
    name: 'fixture-factory',
    async judge({ page }) {
      return [{ rule: 'judge/fixture', severity: 'warn', page, message: 'fixture-factory ran' }]
    },
  }
}
