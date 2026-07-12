export const DEFAULT_X_REQUEST_TIMEOUT_MS = 30_000;
export const DEFAULT_MEDIA_REQUEST_TIMEOUT_MS = 120_000;

export function requestTimeoutMs(value: string | number | undefined, fallback: number): number {
  const parsed = Number(value);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }

  return Math.max(1, Math.floor(parsed));
}

async function withTimeout<T>(options: {
  label: string;
  timeoutMs: number;
  signal?: AbortSignal | null;
  run(signal: AbortSignal): Promise<T>;
}): Promise<T> {
  const timeoutMs = requestTimeoutMs(options.timeoutMs, DEFAULT_X_REQUEST_TIMEOUT_MS);
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  const signal = options.signal ? AbortSignal.any([options.signal, timeoutSignal]) : timeoutSignal;

  try {
    return await options.run(signal);
  } catch (error) {
    if (timeoutSignal.aborted && !options.signal?.aborted) {
      throw new Error(`${options.label} timed out after ${timeoutMs} ms.`, { cause: error });
    }

    throw error;
  }
}

export async function fetchWithTimeout(
  input: string | URL | Request,
  init: RequestInit = {},
  options: { label: string; timeoutMs: number },
): Promise<Response> {
  return withTimeout({
    ...options,
    signal: init.signal,
    run: (signal) => fetch(input, { ...init, signal }),
  });
}

export async function fetchTextWithTimeout(
  input: string | URL | Request,
  init: RequestInit = {},
  options: { label: string; timeoutMs: number },
): Promise<{ response: Response; text: string }> {
  return withTimeout({
    ...options,
    signal: init.signal,
    run: async (signal) => {
      const response = await fetch(input, { ...init, signal });
      const text = await response.text();
      return { response, text };
    },
  });
}
