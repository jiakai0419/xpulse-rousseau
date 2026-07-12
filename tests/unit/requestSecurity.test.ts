import assert from "node:assert/strict";
import { test } from "node:test";
import {
  allowedRequestHost,
  isApplicationJson,
  localRequestOrigin,
  mutationRequestError,
  proxiedResourceRequestError,
  readLimitedRequestBody,
} from "../../src/server/requestSecurity.ts";

test("allowedRequestHost accepts only configured local names on the exact port", () => {
  for (const authority of ["127.0.0.1:3000", "localhost:3000", "[::1]:3000", "reader.internal:3000"]) {
    assert.equal(allowedRequestHost(authority, "reader.internal", 3000), true, authority);
  }

  for (const authority of [
    "attacker.example:3000",
    "localhost.attacker.example:3000",
    "127.0.0.1:4000",
    "localhost",
    "[::1]:4000",
  ]) {
    assert.equal(allowedRequestHost(authority, "reader.internal", 3000), false, authority);
  }
});

test("proxiedResourceRequestError blocks hostile page embeds without blocking Reader or CLI loads", () => {
  assert.equal(proxiedResourceRequestError(undefined), undefined);
  assert.equal(proxiedResourceRequestError("same-origin"), undefined);
  assert.equal(proxiedResourceRequestError("none"), undefined);
  assert.match(proxiedResourceRequestError("cross-site") ?? "", /Cross-site resource proxy/);
  assert.match(proxiedResourceRequestError("same-site") ?? "", /Cross-site resource proxy/);
});

test("localRequestOrigin always uses local HTTP and never forwarded protocol input", () => {
  assert.equal(localRequestOrigin("127.0.0.1:3000", "127.0.0.1", 3000), "http://127.0.0.1:3000");
  assert.throws(
    () => localRequestOrigin("attacker.example:3000", "127.0.0.1", 3000),
    /untrusted Host/,
  );
});

test("mutationRequestError blocks cross-site browser requests and permits same-origin or CLI requests", () => {
  const base = { configuredHost: "127.0.0.1", configuredPort: 3000 };

  assert.equal(mutationRequestError(base), undefined);
  assert.equal(mutationRequestError({
    ...base,
    origin: "http://127.0.0.1:3000",
    secFetchSite: "same-origin",
  }), undefined);
  assert.match(mutationRequestError({
    ...base,
    origin: "https://attacker.example",
    secFetchSite: "cross-site",
  }) ?? "", /not an allowed local origin/);
  assert.match(mutationRequestError({
    ...base,
    origin: "http://localhost:3000",
    secFetchSite: "cross-site",
  }) ?? "", /Cross-site/);
  assert.match(mutationRequestError({ ...base, secFetchSite: "cross-site" }) ?? "", /Origin header/);
});

test("Pulse content type and body helpers enforce JSON and a byte limit", async () => {
  assert.equal(isApplicationJson("application/json; charset=utf-8"), true);
  assert.equal(isApplicationJson("text/plain"), false);

  async function* body() {
    yield Buffer.from("1234");
    yield Buffer.from("5678");
  }

  assert.equal(await readLimitedRequestBody(body(), 8), "12345678");
  await assert.rejects(
    () => readLimitedRequestBody(body(), 7),
    /exceeds the 7-byte limit/,
  );
});
