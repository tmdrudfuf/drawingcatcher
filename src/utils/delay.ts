/** Resolve after `ms` milliseconds. Used by the fake AI providers to simulate latency. */
export const delay = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));
