/**
 * Global Test Teardown
 *
 * Ensures all connections are properly closed after all tests complete
 * Uses a cleanup registry to deterministically close resources
 */

declare global {
  // eslint-disable-next-line no-var
  var __TEST_CLEANUPS__: Array<() => Promise<void>>;
}

export default async function globalTeardown() {
  // Execute all registered cleanup functions
  if (global.__TEST_CLEANUPS__ && global.__TEST_CLEANUPS__.length > 0) {
    const results = await Promise.allSettled(global.__TEST_CLEANUPS__.map((cleanup) => cleanup()));

    const failures = results.filter(
      (result): result is PromiseRejectedResult => result.status === 'rejected'
    );

    let aggregateError: AggregateError | undefined;
    if (failures.length > 0) {
      aggregateError = new AggregateError(
        failures.map((failure) => failure.reason),
        'One or more test cleanup tasks failed'
      );
      console.error('Test cleanup encountered errors:', aggregateError);
    }

    global.__TEST_CLEANUPS__ = [];

    if (aggregateError) {
      throw aggregateError;
    }
  }
}
