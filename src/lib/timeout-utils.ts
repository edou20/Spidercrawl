/**
 * Utility function to add a timeout to a promise.
 * @param promise The promise to timeout
 * @param ms The timeout in milliseconds
 * @param label A label for the timeout error
 * @returns The result of the promise if it resolves within the timeout
 * @throws If the promise does not resolve within the timeout
 */
export async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}