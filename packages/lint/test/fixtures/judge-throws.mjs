/** Fixture judge whose `judge()` always rejects, to test that lint turns it into a warning. */
export default {
  name: 'fixture-throws',
  async judge() {
    throw new Error('judge blew up')
  },
}
