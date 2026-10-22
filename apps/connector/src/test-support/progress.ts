// Waits for a condition whose duration depends on machine load. Fails only
// when the measured progress stops changing, so a busy runner slows the test
// instead of failing it while a real stall still fails quickly.
export async function waitWhileProgressing(
  done: () => boolean,
  progress: () => number,
  describe: () => string,
  stallMs = 10_000,
): Promise<void> {
  let last = progress();
  let changedAt = Date.now();
  while (!done()) {
    await new Promise((resolve) => setTimeout(resolve, 50));
    const current = progress();
    if (current !== last) {
      last = current;
      changedAt = Date.now();
    } else if (Date.now() - changedAt > stallMs) {
      throw new Error(`No progress for ${stallMs}ms: ${describe()}`);
    }
  }
}
