import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { loadDotEnv } from "../../src/server/env.ts";

test("loadDotEnv preserves explicitly empty environment values", () => {
  const directory = mkdtempSync(join(tmpdir(), "xpulse-env-"));
  const filePath = join(directory, ".env");
  const key = "XPULSE_TEST_EMPTY_CREDENTIAL";
  const previous = process.env[key];

  try {
    writeFileSync(filePath, `${key}=real-owner-secret\n`, "utf8");
    process.env[key] = "";

    loadDotEnv(filePath);

    assert.equal(process.env[key], "");
  } finally {
    if (previous === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = previous;
    }
    rmSync(directory, { recursive: true, force: true });
  }
});

test("loadDotEnv fills variables that are genuinely absent", () => {
  const directory = mkdtempSync(join(tmpdir(), "xpulse-env-"));
  const filePath = join(directory, ".env");
  const key = "XPULSE_TEST_NEW_VALUE";
  const previous = process.env[key];

  try {
    writeFileSync(filePath, `${key}='from-dotenv'\n`, "utf8");
    delete process.env[key];

    loadDotEnv(filePath);

    assert.equal(process.env[key], "from-dotenv");
  } finally {
    if (previous === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = previous;
    }
    rmSync(directory, { recursive: true, force: true });
  }
});
