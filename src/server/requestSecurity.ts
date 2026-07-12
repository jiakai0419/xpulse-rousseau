export const MAX_JSON_REQUEST_BODY_BYTES = 16 * 1024;

export class RequestBodyTooLargeError extends Error {
  readonly statusCode = 413;
  readonly maxBytes: number;

  constructor(maxBytes: number) {
    super(`Request body exceeds the ${maxBytes}-byte limit.`);
    this.maxBytes = maxBytes;
  }
}

function normalizedHostname(hostname: string): string {
  return hostname.replace(/^\[|\]$/g, "").toLowerCase();
}

function parsedAuthority(authority: string): { hostname: string; port: number } | undefined {
  try {
    const url = new URL(`http://${authority}`);

    if (url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
      return undefined;
    }

    return {
      hostname: normalizedHostname(url.hostname),
      port: url.port ? Number(url.port) : 80,
    };
  } catch {
    return undefined;
  }
}

export function allowedRequestHost(
  hostHeader: string | undefined,
  configuredHost: string,
  configuredPort: number,
): boolean {
  if (!hostHeader) {
    return false;
  }

  const authority = parsedAuthority(hostHeader);

  if (!authority || authority.port !== configuredPort) {
    return false;
  }

  const allowedHostnames = new Set([
    normalizedHostname(configuredHost),
    "localhost",
    "127.0.0.1",
    "::1",
  ]);

  return allowedHostnames.has(authority.hostname);
}

export function localRequestOrigin(hostHeader: string, configuredHost: string, configuredPort: number): string {
  if (!allowedRequestHost(hostHeader, configuredHost, configuredPort)) {
    throw new Error("Cannot build an origin from an untrusted Host header.");
  }

  return `http://${hostHeader}`;
}

function allowedOrigin(origin: string, configuredHost: string, configuredPort: number): boolean {
  try {
    const url = new URL(origin);

    if (url.protocol !== "http:" || url.pathname !== "/" || url.search || url.hash) {
      return false;
    }

    return allowedRequestHost(url.host, configuredHost, configuredPort);
  } catch {
    return false;
  }
}

export function mutationRequestError(options: {
  origin?: string;
  secFetchSite?: string;
  configuredHost: string;
  configuredPort: number;
}): string | undefined {
  const origin = options.origin?.trim();
  const fetchSite = options.secFetchSite?.trim().toLowerCase();

  // Non-browser clients such as owner-run smoke commands do not send either header.
  // Browsers do, and an attacker-controlled page cannot suppress them.
  if (!origin && !fetchSite) {
    return undefined;
  }

  if (!origin) {
    return "Browser mutation requests must include an Origin header.";
  }

  if (!allowedOrigin(origin, options.configuredHost, options.configuredPort)) {
    return "Mutation request Origin is not an allowed local origin.";
  }

  if (fetchSite && fetchSite !== "same-origin" && fetchSite !== "none") {
    return "Cross-site mutation requests are not allowed.";
  }

  return undefined;
}

export function proxiedResourceRequestError(secFetchSite: string | undefined): string | undefined {
  const fetchSite = secFetchSite?.trim().toLowerCase();

  // Same-origin Reader loads and explicit owner-run CLI requests are allowed.
  // Browsers reliably attach cross-site Fetch Metadata to hostile page embeds.
  if (!fetchSite || fetchSite === "same-origin" || fetchSite === "none") {
    return undefined;
  }

  return "Cross-site resource proxy requests are not allowed.";
}

export function isApplicationJson(contentType: string | undefined): boolean {
  return contentType?.split(";", 1)[0].trim().toLowerCase() === "application/json";
}

export async function readLimitedRequestBody(
  request: AsyncIterable<unknown>,
  maxBytes = MAX_JSON_REQUEST_BODY_BYTES,
): Promise<string> {
  const chunks: Buffer[] = [];
  let totalBytes = 0;

  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk)
      ? chunk
      : chunk instanceof Uint8Array
        ? Buffer.from(chunk)
        : Buffer.from(String(chunk));
    totalBytes += buffer.byteLength;

    if (totalBytes > maxBytes) {
      throw new RequestBodyTooLargeError(maxBytes);
    }

    chunks.push(buffer);
  }

  return Buffer.concat(chunks).toString("utf8");
}
