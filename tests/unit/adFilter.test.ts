import assert from "node:assert/strict";
import { test } from "node:test";
import { decideAdFilter } from "../../src/services/filtering/adFilter.ts";
import { testPost } from "../helpers/posts.ts";

test("decideAdFilter excludes strong promotional language", () => {
  const decision = decideAdFilter(testPost({ text: "Use code BUILD50 for 50% off. Limited time offer. https://example.com" }));

  assert.equal(decision.excluded, true);
});

test("decideAdFilter keeps ordinary product commentary", () => {
  const decision = decideAdFilter(testPost({ text: "A product team should pick one excellent default sort before adding more filters." }));

  assert.equal(decision.excluded, false);
});
