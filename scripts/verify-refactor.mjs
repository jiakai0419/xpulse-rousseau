import { spawnSync } from "node:child_process";

const steps = [
  ["Environment check", "npm", ["run", "env:check"], 30_000],
  ["Type-check application source", "npm", ["run", "typecheck"], 60_000],
  ["Isolated HTTP entry point", "npm", ["run", "test:server-entry"], 30_000],
  ["Unit tests", "npm", ["run", "test:unit"], 120_000],
  ["API smoke", "npm", ["run", "test:smoke-api"], 60_000],
  ["UI smoke", "npm", ["run", "test:smoke-ui"], 150_000],
  ["X display replay rendering", "npm", ["run", "x-display:test-replay-rendering"], 900_000],
];

for (const [label, command, args, timeout] of steps) {
  console.log(`\n==> ${label}`);
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    env: process.env,
    stdio: "inherit",
    timeout,
    killSignal: "SIGTERM",
  });

  if (result.status !== 0) {
    const detail = result.error?.code === "ETIMEDOUT" ? ` (timed out after ${timeout}ms)` : "";
    console.error(`\nRefactor baseline check failed at: ${label}${detail}`);
    process.exitCode = result.status ?? 1;
    break;
  }
}

if (!process.exitCode) {
  console.log("\nOK refactor baseline check passed.");
}
