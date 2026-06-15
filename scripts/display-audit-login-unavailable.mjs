console.error(
  [
    "X Original screenshot login is not available in this environment.",
    "",
    "The dedicated Playwright audit profile has been blocked by X/Google login risk controls, including:",
    '- "This browser or app may not be secure"',
    '- "We’ve temporarily limited your login. Please try again later."',
    "",
    "Do not keep retrying this login path. Use local replay/regression checks as the automated baseline.",
    "For Original X comparison, use manual inspection from an already-authenticated normal Chrome window.",
  ].join("\n"),
);

process.exitCode = 1;
