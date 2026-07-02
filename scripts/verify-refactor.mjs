import { spawnSync } from "node:child_process";

const steps = [
  ["Environment check", "npm", ["run", "env:check"]],
  ["Unit tests", "npm", ["run", "test:unit"]],
  ["API smoke", "npm", ["run", "test:smoke-api"]],
  ["UI smoke", "npm", ["run", "test:smoke-ui"]],
  ["X display replay rendering", "npm", ["run", "x-display:test-replay-rendering"]],
];

for (const [label, command, args] of steps) {
  console.log(`\n==> ${label}`);
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    env: process.env,
    stdio: "inherit",
  });

  if (result.status !== 0) {
    console.error(`\nRefactor baseline check failed at: ${label}`);
    process.exitCode = result.status ?? 1;
    break;
  }
}

if (!process.exitCode) {
  console.log("\nOK refactor baseline check passed.");
}
