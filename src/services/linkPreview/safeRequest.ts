import { lookup as lookupHostname } from "node:dns/promises";
import { request as requestHttp, type RequestOptions } from "node:http";
import { request as requestHttps } from "node:https";
import { BlockList, isIP, type LookupFunction } from "node:net";
import { Readable } from "node:stream";

export type LinkPreviewResolvedAddress = {
  address: string;
  family: 4 | 6;
};

export type LinkPreviewHostnameResolver = (hostname: string) => Promise<readonly LinkPreviewResolvedAddress[]>;

export type LinkPreviewRequestOptions = {
  addresses: readonly LinkPreviewResolvedAddress[];
  headers: Record<string, string>;
  signal: AbortSignal;
};

export type LinkPreviewRequester = (url: string, options: LinkPreviewRequestOptions) => Promise<Response>;

const blockedIpv4Addresses = new BlockList();
const blockedIpv6Addresses = new BlockList();

for (const [network, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 3],
] as const) {
  blockedIpv4Addresses.addSubnet(network, prefix, "ipv4");
}

for (const [network, prefix] of [
  ["::", 96],
  ["::ffff:0:0", 96],
  ["64:ff9b::", 96],
  ["64:ff9b:1::", 48],
  ["100::", 64],
  ["2001::", 32],
  ["2001:2::", 48],
  ["2001:10::", 28],
  ["2001:20::", 28],
  ["2001:db8::", 32],
  ["2002::", 16],
  ["fc00::", 7],
  ["fe80::", 10],
  ["fec0::", 10],
  ["ff00::", 8],
] as const) {
  blockedIpv6Addresses.addSubnet(network, prefix, "ipv6");
}

function normalizedHostname(hostname: string): string {
  return hostname
    .replace(/^\[|\]$/g, "")
    .replace(/\.$/, "")
    .toLowerCase();
}

export function isBlockedLinkPreviewHostname(hostname: string): boolean {
  const host = normalizedHostname(hostname);

  if (isIP(host)) {
    return false;
  }

  return (
    !host ||
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    host === "home.arpa" ||
    host.endsWith(".home.arpa") ||
    !host.includes(".")
  );
}

export function isBlockedLinkPreviewAddress(address: string): boolean {
  const withoutScope = address.split("%", 1)[0];
  const family = isIP(withoutScope);

  if (family === 4) {
    return blockedIpv4Addresses.check(withoutScope, "ipv4");
  }

  if (family === 6) {
    return blockedIpv6Addresses.check(withoutScope, "ipv6");
  }

  return true;
}

export const resolveLinkPreviewHostname: LinkPreviewHostnameResolver = async (hostname) => {
  const addresses = await lookupHostname(hostname, { all: true, order: "verbatim" });

  return addresses.flatMap((entry) => {
    if (entry.family !== 4 && entry.family !== 6) {
      return [];
    }

    return [{ address: entry.address, family: entry.family }];
  });
};

export async function validatedLinkPreviewAddresses(
  rawUrl: string,
  resolveHostname: LinkPreviewHostnameResolver = resolveLinkPreviewHostname,
): Promise<readonly LinkPreviewResolvedAddress[]> {
  const url = new URL(rawUrl);

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Link preview URL must use HTTP or HTTPS");
  }

  const hostname = normalizedHostname(url.hostname);

  if (isBlockedLinkPreviewHostname(hostname)) {
    throw new Error("Link preview URL uses a local or private hostname");
  }

  const literalFamily = isIP(hostname);
  const resolved = literalFamily
    ? [{ address: hostname, family: literalFamily as 4 | 6 }]
    : await resolveHostname(hostname);
  const addresses: LinkPreviewResolvedAddress[] = [];
  const seen = new Set<string>();

  for (const entry of resolved) {
    const family = isIP(entry.address.split("%", 1)[0]);

    if (family !== entry.family || (family !== 4 && family !== 6)) {
      throw new Error("Link preview hostname returned an invalid network address");
    }

    if (isBlockedLinkPreviewAddress(entry.address)) {
      throw new Error("Link preview hostname resolves to a local or private network address");
    }

    const key = `${entry.family}:${entry.address}`;

    if (!seen.has(key)) {
      seen.add(key);
      addresses.push({ address: entry.address, family: entry.family });
    }
  }

  if (!addresses.length) {
    throw new Error("Link preview hostname did not resolve to a public network address");
  }

  return addresses;
}

function responseHeaders(headers: Readonly<Record<string, string | string[] | undefined>>): Headers {
  const result = new Headers();

  for (const [name, value] of Object.entries(headers)) {
    if (Array.isArray(value)) {
      for (const item of value) {
        result.append(name, item);
      }
    } else if (value !== undefined) {
      result.set(name, value);
    }
  }

  return result;
}

export function isSupportedLinkPreviewResponseStatus(status: number): boolean {
  return Number.isInteger(status) && status >= 200 && status <= 599;
}

export const requestLinkPreviewFromValidatedAddress: LinkPreviewRequester = (rawUrl, options) => new Promise((resolve, reject) => {
  const url = new URL(rawUrl);
  const request = url.protocol === "https:" ? requestHttps : requestHttp;
  const lookup: LookupFunction = (_hostname, lookupOptions, callback) => {
    const requestedFamily = lookupOptions.family === 4 || lookupOptions.family === 6 ? lookupOptions.family : undefined;
    const addresses = requestedFamily
      ? options.addresses.filter((entry) => entry.family === requestedFamily)
      : [...options.addresses];

    if (!addresses.length) {
      const error = Object.assign(new Error("No validated address matches the requested network family"), {
        code: "ENOTFOUND",
      });
      callback(error, "", 0);
      return;
    }

    if (lookupOptions.all) {
      callback(null, addresses);
      return;
    }

    callback(null, addresses[0].address, addresses[0].family);
  };

  const requestOptions: RequestOptions & {
    autoSelectFamily: boolean;
    autoSelectFamilyAttemptTimeout: number;
  } = {
    agent: false,
    autoSelectFamily: true,
    autoSelectFamilyAttemptTimeout: 250,
    headers: options.headers,
    lookup,
    method: "GET",
    signal: options.signal,
  };
  const outgoing = request(url, requestOptions, (incoming) => {
    const status = incoming.statusCode ?? 500;

    if (!isSupportedLinkPreviewResponseStatus(status)) {
      incoming.destroy();
      reject(new Error(`Link preview server returned unsupported HTTP status ${status}`));
      return;
    }

    try {
      const body = [204, 205, 304].includes(status)
        ? null
        : Readable.toWeb(incoming) as ReadableStream<Uint8Array>;

      resolve(new Response(body, {
        headers: responseHeaders(incoming.headers),
        status,
        statusText: incoming.statusMessage,
      }));
    } catch (error) {
      incoming.destroy();
      reject(error);
    }
  });

  outgoing.once("error", reject);
  outgoing.end();
});
