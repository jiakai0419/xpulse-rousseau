export type AIOperation = "scoring" | "translation";

export type ConfiguredOpenAIModels = Record<AIOperation, string>;

const DEFAULT_MODEL = "gpt-5";

function envKeyForOperation(operation: AIOperation): string {
  if (operation === "scoring") {
    return "OPENAI_SCORING_MODEL";
  }

  return "OPENAI_TRANSLATION_MODEL";
}

export function openAIModelForOperation(env: Record<string, string | undefined>, operation: AIOperation): string {
  return env[envKeyForOperation(operation)]?.trim() || env.OPENAI_MODEL?.trim() || DEFAULT_MODEL;
}

export function configuredOpenAIModels(env: Record<string, string | undefined>): ConfiguredOpenAIModels {
  return {
    scoring: openAIModelForOperation(env, "scoring"),
    translation: openAIModelForOperation(env, "translation"),
  };
}
