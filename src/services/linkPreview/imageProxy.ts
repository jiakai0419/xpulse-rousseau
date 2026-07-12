import { Buffer } from "node:buffer";
import {
  requestLinkPreviewFromValidatedAddress,
  validatedLinkPreviewAddresses,
  type LinkPreviewHostnameResolver,
  type LinkPreviewRequester,
} from "./safeRequest.ts";

export const DEFAULT_LINK_PREVIEW_IMAGE_TIMEOUT_MS = 8_000;
export const DEFAULT_LINK_PREVIEW_IMAGE_MAX_BYTES = 5 * 1024 * 1024;
const MAX_REDIRECTS = 4;
const ALLOWED_IMAGE_CONTENT_TYPES = new Set([
  "image/avif",
  "image/gif",
  "image/jpeg",
  "image/jpg",
  "image/pjpeg",
  "image/png",
  "image/webp",
]);

export type LinkPreviewImageResult = {
  body: Buffer;
  contentType: string;
  finalUrl: string;
};

export type LinkPreviewImageOptions = {
  requester?: LinkPreviewRequester;
  resolveHostname?: LinkPreviewHostnameResolver;
  timeoutMs?: number;
  maxBytes?: number;
};

function abortable<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) {
    return Promise.reject(signal.reason ?? new Error("Link preview image request aborted"));
  }

  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason ?? new Error("Link preview image request aborted"));
    signal.addEventListener("abort", abort, { once: true });
    operation.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}

async function readImageWithinLimit(response: Response, maxBytes: number, signal: AbortSignal): Promise<Buffer> {
  if (!response.body) {
    return Buffer.alloc(0);
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  try {
    while (true) {
      const { done, value } = await abortable(reader.read(), signal);

      if (done) {
        break;
      }

      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        throw new Error(`Link preview image exceeds the ${maxBytes}-byte limit.`);
      }
      chunks.push(value);
    }

    return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)), totalBytes);
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}

export async function fetchLinkPreviewImage(
  rawUrl: string,
  options: LinkPreviewImageOptions = {},
): Promise<LinkPreviewImageResult> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_LINK_PREVIEW_IMAGE_TIMEOUT_MS;
  const maxBytes = options.maxBytes ?? DEFAULT_LINK_PREVIEW_IMAGE_MAX_BYTES;
  const requester = options.requester ?? requestLinkPreviewFromValidatedAddress;
  let currentUrl = rawUrl;

  for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(new Error("Link preview image request timed out")),
      timeoutMs,
    );

    try {
      const addresses = await abortable(
        validatedLinkPreviewAddresses(currentUrl, options.resolveHostname),
        controller.signal,
      );
      const response = await requester(currentUrl, {
        addresses,
        signal: controller.signal,
        headers: {
          Accept: "image/avif,image/webp,image/png,image/jpeg,image/gif;q=0.9,*/*;q=0.1",
          "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Xpulse/1.0 Safari/537.36",
        },
      });

      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get("location");
        await response.body?.cancel().catch(() => undefined);

        if (!location) {
          throw new Error("Link preview image redirect did not include a Location header.");
        }

        currentUrl = new URL(location, currentUrl).toString();
        continue;
      }

      if (!response.ok) {
        await response.body?.cancel().catch(() => undefined);
        throw new Error(`Link preview image request failed with HTTP ${response.status}.`);
      }

      const contentType = (response.headers.get("content-type") ?? "").split(";", 1)[0].trim().toLowerCase();
      if (!ALLOWED_IMAGE_CONTENT_TYPES.has(contentType)) {
        await response.body?.cancel().catch(() => undefined);
        throw new Error(`Link preview resource is not a supported raster image (${contentType || "missing content type"}).`);
      }

      const contentLength = Number(response.headers.get("content-length"));
      if (Number.isFinite(contentLength) && contentLength > maxBytes) {
        await response.body?.cancel().catch(() => undefined);
        throw new Error(`Link preview image exceeds the ${maxBytes}-byte limit.`);
      }

      return {
        body: await readImageWithinLimit(response, maxBytes, controller.signal),
        contentType,
        finalUrl: currentUrl,
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  throw new Error(`Link preview image exceeded ${MAX_REDIRECTS} redirects.`);
}
