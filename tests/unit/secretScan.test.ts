import assert from "node:assert/strict";
import test from "node:test";
import { scanTextForSecrets } from "../../scripts/secret-scan-core.mjs";

test("tracked secret scanner finds credential-shaped values without returning the value", () => {
  const credential = ["sk", "proj", "abcdefghijklmnopqrstuvwxyz123456"].join("-");
  const findings = scanTextForSecrets(`OPENAI_API_KEY=${credential}\n`);

  assert.equal(findings.length, 1);
  assert.equal(findings[0].label, "OpenAI API key");
  assert.equal(findings[0].line, 1);
  assert.equal(findings[0].redacted.includes(credential), false);
});

test("tracked secret scanner ignores placeholders and normal documentation", () => {
  assert.deepEqual(scanTextForSecrets("OPENAI_API_KEY=\nX_USER_ACCESS_TOKEN=<token>\n"), []);
});
