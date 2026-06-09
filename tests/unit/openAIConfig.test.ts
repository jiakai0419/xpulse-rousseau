import assert from "node:assert/strict";
import { test } from "node:test";
import { configuredOpenAIModels, openAIModelForOperation } from "../../src/config/openai.ts";

test("configuredOpenAIModels uses default configured models", () => {
  assert.deepEqual(configuredOpenAIModels({}), {
    scoring: "gpt-5",
    translation: "gpt-5",
  });
});

test("configuredOpenAIModels uses a shared model by default", () => {
  assert.deepEqual(configuredOpenAIModels({ OPENAI_MODEL: "gpt-5" }), {
    scoring: "gpt-5",
    translation: "gpt-5",
  });
});

test("configuredOpenAIModels uses explicit per-operation model configuration", () => {
  const env = {
    OPENAI_MODEL: "gpt-5",
    OPENAI_SCORING_MODEL: "gpt-5-nano",
    OPENAI_TRANSLATION_MODEL: "gpt-5-nano",
  };

  assert.deepEqual(configuredOpenAIModels(env), {
    scoring: "gpt-5-nano",
    translation: "gpt-5-nano",
  });
});

test("openAIModelForOperation reads each configured refresh operation", () => {
  assert.equal(openAIModelForOperation({ OPENAI_MODEL: "gpt-5" }, "scoring"), "gpt-5");
  assert.equal(openAIModelForOperation({ OPENAI_MODEL: "gpt-5" }, "translation"), "gpt-5");
  assert.equal(openAIModelForOperation({ OPENAI_SCORING_MODEL: "gpt-5-nano" }, "scoring"), "gpt-5-nano");
  assert.equal(openAIModelForOperation({ OPENAI_TRANSLATION_MODEL: "gpt-5-mini" }, "translation"), "gpt-5-mini");
});
