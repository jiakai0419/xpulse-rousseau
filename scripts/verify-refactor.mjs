import { spawnSync } from "node:child_process";

const steps = [
  ["Environment doctor", "npm", ["run", "doctor"]],
  ["Unit tests", "npm", ["test"]],
  ["Replay smoke", "npm", ["run", "smoke"]],
  ["Browser smoke", "npm", ["run", "browser:smoke"]],
  ["Display regression", "npm", ["run", "display:regression"]],
];

for (const [label, command, args] of steps) {
  console.log(`\n==> ${label}`);
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    env: process.env,
    stdio: "inherit",
  });

  if (result.status !== 0) {
    console.error(`\nRefactor verification failed at: ${label}`);
    process.exitCode = result.status ?? 1;
    break;
  }
}

if (!process.exitCode) {
  console.log("\nOK refactor verification passed.");
}
