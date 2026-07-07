export function createMetricsRegistry() {
  const failureCounters = {};

  return {
    incrementFailure(code) {
      const key = String(code || "UNKNOWN_ERROR");
      failureCounters[key] = (failureCounters[key] || 0) + 1;
    },
    snapshot() {
      return { failureCounters: { ...failureCounters } };
    }
  };
}
