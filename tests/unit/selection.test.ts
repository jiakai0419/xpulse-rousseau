import assert from "node:assert/strict";
import { test } from "node:test";
import { selectedPostCountFromEnv } from "../../src/config/selection.ts";

test("selectedPostCountFromEnv defaults to seven", () => {
  assert.equal(selectedPostCountFromEnv({}), 7);
});

test("selectedPostCountFromEnv clamps invalid and large values", () => {
  assert.equal(selectedPostCountFromEnv({ SELECTED_POST_COUNT: "abc" }), 7);
  assert.equal(selectedPostCountFromEnv({ SELECTED_POST_COUNT: "0" }), 1);
  assert.equal(selectedPostCountFromEnv({ SELECTED_POST_COUNT: "50" }), 25);
});
