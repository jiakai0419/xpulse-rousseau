import { readFileSync } from "node:fs";

export function loadDotEnv(filePath = ".env"): void {
  let raw: string;

  try {
    raw = readFileSync(filePath, "utf8");
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return;
    }

    throw error;
  }

  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const separator = trimmed.indexOf("=");
    if (separator === -1) {
      continue;
    }

    const key = trimmed.slice(0, separator).trim();
    const value = trimmed.slice(separator + 1).trim().replace(/^["']|["']$/g, "");

    // Presence, rather than truthiness, controls precedence. Test and smoke
    // processes intentionally use an empty value to block real credentials
    // from being restored from the owner's .env file.
    if (!Object.prototype.hasOwnProperty.call(process.env, key)) {
      process.env[key] = value;
    }
  }
}
