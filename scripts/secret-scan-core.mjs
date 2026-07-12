const SECRET_PATTERNS = [
  { label: "OpenAI API key", expression: /\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{20,}\b/g },
  { label: "GitHub token", expression: /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g },
  { label: "AWS access key", expression: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g },
  { label: "private key", expression: /-----BEGIN(?: [A-Z0-9]+)? PRIVATE KEY-----/g },
];

function redacted(value) {
  if (value.length <= 8) {
    return "[redacted]";
  }
  return `${value.slice(0, 4)}…${value.slice(-4)}`;
}

export function scanTextForSecrets(text) {
  const findings = [];

  for (const pattern of SECRET_PATTERNS) {
    pattern.expression.lastIndex = 0;
    for (const match of text.matchAll(pattern.expression)) {
      const before = text.slice(0, match.index);
      findings.push({
        label: pattern.label,
        line: before.split("\n").length,
        redacted: redacted(match[0]),
      });
    }
  }

  return findings;
}
