/**
 * Lets the test process exit.
 *
 * The suite finishes in about nine seconds and then sits there forever. The
 * reason is not the tests: `@semaphore-protocol/proof` generates real Groth16
 * proofs through snarkjs, which builds a pool of worker threads for the bn128
 * curve and keeps it warm. Nothing closes it, so Node has live handles and
 * refuses to exit long after the last assertion passed.
 *
 * Locally that reads as "the tests are slow" and gets interrupted with Ctrl-C.
 * In CI there is nobody to press it: the job runs until the timeout and is
 * reported as a failure, with a log whose last line says 185 passing.
 *
 * `after()` at the top level of a spec file is a ROOT hook in Mocha, so this
 * runs once when the whole run is over, whatever else was loaded. The curve is
 * cached on `globalThis` by ffjavascript, which is snarkjs's own escape hatch
 * for exactly this; `terminate` is checked rather than assumed, because a run
 * that never proved anything never built one.
 */
after(async function () {
  const curva = (globalThis as { curve_bn128?: { terminate?: () => Promise<void> } })
    .curve_bn128;
  if (typeof curva?.terminate === 'function') {
    await curva.terminate();
  }
});
