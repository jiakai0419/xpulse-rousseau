export function extractResponseText(payload: unknown): string | undefined {
  if (!payload || typeof payload !== "object") {
    return undefined;
  }

  const direct = (payload as { output_text?: unknown }).output_text;
  if (typeof direct === "string") {
    return direct;
  }

  const output = (payload as { output?: unknown }).output;
  if (!Array.isArray(output)) {
    return undefined;
  }

  for (const item of output) {
    if (!item || typeof item !== "object") {
      continue;
    }

    const content = (item as { content?: unknown }).content;
    if (!Array.isArray(content)) {
      continue;
    }

    for (const contentItem of content) {
      if (!contentItem || typeof contentItem !== "object") {
        continue;
      }

      const text = (contentItem as { text?: unknown }).text;
      if (typeof text === "string") {
        return text;
      }
    }
  }

  return undefined;
}

export type OpenAIUsage = {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cachedInputTokens?: number;
  reasoningTokens?: number;
};

export type OpenAIJsonResult<T> = {
  data: T;
  model?: string;
  usage?: OpenAIUsage;
};

const DEFAULT_OPENAI_TIMEOUT_MS = 600_000;
const DEFAULT_OPENAI_MAX_ATTEMPTS = 3;
const DEFAULT_OPENAI_RETRY_DELAY_MS = 500;

function formatTimeout(milliseconds: number): string {
  return milliseconds % 1000 === 0 ? `${milliseconds / 1000}s` : `${milliseconds}ms`;
}

function describeErrorCause(error: Error): string {
  const cause = (error as { cause?: unknown }).cause;

  if (!cause) {
    return "";
  }

  if (cause instanceof Error) {
    return ` Cause: ${cause.message}`;
  }

  return ` Cause: ${String(cause)}`;
}

function isRetryableFetchFailure(error: unknown): error is Error {
  return error instanceof Error && error.message === "fetch failed";
}

async function sleep(milliseconds: number): Promise<void> {
  if (milliseconds <= 0) {
    return;
  }

  await new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function extractUsage(payload: unknown): OpenAIUsage | undefined {
  if (!payload || typeof payload !== "object") {
    return undefined;
  }

  const usage = (payload as { usage?: unknown }).usage;
  if (!usage || typeof usage !== "object") {
    return undefined;
  }

  const inputTokens = (usage as { input_tokens?: unknown }).input_tokens;
  const outputTokens = (usage as { output_tokens?: unknown }).output_tokens;
  const totalTokens = (usage as { total_tokens?: unknown }).total_tokens;

  if (typeof inputTokens !== "number" || typeof outputTokens !== "number" || typeof totalTokens !== "number") {
    return undefined;
  }

  const inputDetails = (usage as { input_tokens_details?: unknown }).input_tokens_details;
  const outputDetails = (usage as { output_tokens_details?: unknown }).output_tokens_details;
  const cachedInputTokens = inputDetails && typeof inputDetails === "object" ? (inputDetails as { cached_tokens?: unknown }).cached_tokens : undefined;
  const reasoningTokens = outputDetails && typeof outputDetails === "object" ? (outputDetails as { reasoning_tokens?: unknown }).reasoning_tokens : undefined;

  return {
    inputTokens,
    outputTokens,
    totalTokens,
    cachedInputTokens: typeof cachedInputTokens === "number" ? cachedInputTokens : undefined,
    reasoningTokens: typeof reasoningTokens === "number" ? reasoningTokens : undefined,
  };
}

export async function callOpenAIJson<T>(options: {
  apiKey: string;
  model: string;
  system: string;
  user: string;
  schemaName: string;
  schema: Record<string, unknown>;
  timeoutMs?: number;
  maxAttempts?: number;
  retryDelayMs?: number;
}): Promise<OpenAIJsonResult<T>> {
  const controller = new AbortController();
  const timeoutMs = options.timeoutMs ?? DEFAULT_OPENAI_TIMEOUT_MS;
  const maxAttempts = Math.max(1, Math.floor(options.maxAttempts ?? DEFAULT_OPENAI_MAX_ATTEMPTS));
  const retryDelayMs = Math.max(0, options.retryDelayMs ?? DEFAULT_OPENAI_RETRY_DELAY_MS);
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  try {
    const body = JSON.stringify({
      model: options.model,
      input: [
        {
          role: "system",
          content: [
            {
              type: "input_text",
              text: options.system,
            },
          ],
        },
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: options.user,
            },
          ],
        },
      ],
      text: {
        format: {
          type: "json_schema",
          name: options.schemaName,
          strict: true,
          schema: options.schema,
        },
      },
    });
    let response: Response | undefined;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        response = await fetch("https://api.openai.com/v1/responses", {
          method: "POST",
          signal: controller.signal,
          headers: {
            Authorization: `Bearer ${options.apiKey}`,
            "Content-Type": "application/json",
          },
          body,
        });
        break;
      } catch (error) {
        if (timedOut || (error instanceof Error && error.name === "AbortError")) {
          throw error;
        }

        if (!isRetryableFetchFailure(error) || attempt >= maxAttempts) {
          throw error;
        }

        await sleep(retryDelayMs * attempt);
      }
    }

    if (!response) {
      throw new Error("OpenAI request did not return a response.");
    }

    if (!response.ok) {
      throw new Error(`OpenAI request failed with ${response.status}: ${await response.text()}`);
    }

    const payload = await response.json();
    const text = extractResponseText(payload);

    if (!text) {
      throw new Error("OpenAI response did not include output text.");
    }

    return {
      data: JSON.parse(text) as T,
      model: typeof (payload as { model?: unknown }).model === "string" ? (payload as { model: string }).model : undefined,
      usage: extractUsage(payload),
    };
  } catch (error) {
    if (timedOut) {
      throw new Error(`OpenAI request timed out after ${formatTimeout(timeoutMs)}.`);
    }

    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("OpenAI request was aborted.");
    }

    if (error instanceof Error && error.message === "fetch failed") {
      throw new Error(`OpenAI request failed before response: fetch failed.${describeErrorCause(error)}`);
    }

    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
