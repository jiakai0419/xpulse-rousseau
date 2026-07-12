import assert from "node:assert/strict";
import test from "node:test";
import { shutdownAuditServer } from "../../scripts/fresh-pulse-audit.mjs";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

test("Fresh Pulse cleanup keeps waiting instead of force-killing a possibly paid job", async () => {
  const exit = deferred<{ code: number }>();
  const signals: string[] = [];
  const messages: string[] = [];
  const child = {
    kill(signal: string) {
      signals.push(signal);
      return true;
    },
  };

  const shutdown = shutdownAuditServer({
    child,
    childExit: exit.promise,
    activeJobId: "job-paid",
    paidShutdownTimeoutMs: 5,
    log: (message: string) => messages.push(message),
  });

  await new Promise((resolveWait) => setTimeout(resolveWait, 15));
  assert.deepEqual(signals, ["SIGTERM"]);
  assert.match(messages.join("\n"), /will not SIGKILL/);

  exit.resolve({ code: 0 });
  assert.deepEqual(await shutdown, { forced: false });
});

test("Fresh Pulse cleanup force-kills paid work only after explicit opt-in", async () => {
  const exit = deferred<{ code: number }>();
  const signals: string[] = [];
  const child = {
    kill(signal: string) {
      signals.push(signal);
      if (signal === "SIGKILL") {
        exit.resolve({ code: 137 });
      }
      return true;
    },
  };

  const result = await shutdownAuditServer({
    child,
    childExit: exit.promise,
    activeJobId: "job-paid",
    paidShutdownTimeoutMs: 5,
    forceKillPaidJobOnTimeout: true,
    log: () => {},
  });

  assert.deepEqual(signals, ["SIGTERM", "SIGKILL"]);
  assert.deepEqual(result, { forced: true });
});
