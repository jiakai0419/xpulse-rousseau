import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { inflateSync } from "node:zlib";

function clampRatio(value, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.min(Math.max(parsed, 0.9), 1);
}

function parsePng(filePath) {
  const buffer = readFileSync(filePath);
  const signature = buffer.subarray(0, 8).toString("hex");

  if (signature !== "89504e470d0a1a0a") {
    throw new Error("not_png");
  }

  let offset = 8;
  let width;
  let height;
  let bitDepth;
  let colorType;
  const idatChunks = [];

  while (offset + 8 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString("ascii", offset + 4, offset + 8);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;

    if (dataEnd + 4 > buffer.length) {
      throw new Error("truncated_png_chunk");
    }

    if (type === "IHDR") {
      width = buffer.readUInt32BE(dataStart);
      height = buffer.readUInt32BE(dataStart + 4);
      bitDepth = buffer[dataStart + 8];
      colorType = buffer[dataStart + 9];
    } else if (type === "IDAT") {
      idatChunks.push(buffer.subarray(dataStart, dataEnd));
    } else if (type === "IEND") {
      break;
    }

    offset = dataEnd + 4;
  }

  if (!width || !height || !idatChunks.length) {
    throw new Error("missing_png_data");
  }

  return {
    width,
    height,
    bitDepth,
    colorType,
    pixels: inflateSync(Buffer.concat(idatChunks)),
  };
}

function parseJpegDimensions(filePath) {
  const buffer = readFileSync(filePath);

  if (buffer[0] !== 0xff || buffer[1] !== 0xd8) {
    throw new Error("not_jpeg");
  }

  let offset = 2;
  while (offset + 9 < buffer.length) {
    if (buffer[offset] !== 0xff) {
      offset += 1;
      continue;
    }

    const marker = buffer[offset + 1];
    offset += 2;

    if (marker === 0xd9 || marker === 0xda) {
      break;
    }

    if (offset + 2 > buffer.length) {
      throw new Error("truncated_jpeg_segment");
    }

    const length = buffer.readUInt16BE(offset);
    if (length < 2 || offset + length > buffer.length) {
      throw new Error("invalid_jpeg_segment");
    }

    const isStartOfFrame = [
      0xc0,
      0xc1,
      0xc2,
      0xc3,
      0xc5,
      0xc6,
      0xc7,
      0xc9,
      0xca,
      0xcb,
      0xcd,
      0xce,
      0xcf,
    ].includes(marker);

    if (isStartOfFrame) {
      return {
        width: buffer.readUInt16BE(offset + 5),
        height: buffer.readUInt16BE(offset + 3),
      };
    }

    offset += length;
  }

  throw new Error("missing_jpeg_dimensions");
}

function inspectJpegViaSips(filePath, options) {
  const dir = mkdtempSync(join(tmpdir(), "xpulse-screenshot-probe-"));
  const pngPath = join(dir, "converted.png");

  try {
    const result = spawnSync("sips", ["-s", "format", "png", filePath, "--out", pngPath], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });

    if (result.status !== 0) {
      return undefined;
    }

    const parsed = parsePng(pngPath);
    if (parsed.bitDepth !== 8 || ![2, 6].includes(parsed.colorType)) {
      return {
        blank: false,
        reason: `unsupported_converted_png_format:${parsed.bitDepth}:${parsed.colorType}`,
        width: parsed.width,
        height: parsed.height,
        imageType: "jpeg",
      };
    }

    return {
      ...inspectDecodedRgbaPng(parsed, options),
      imageType: "jpeg",
      convertedForProbe: true,
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function paethPredictor(left, above, upperLeft) {
  const predictor = left + above - upperLeft;
  const leftDistance = Math.abs(predictor - left);
  const aboveDistance = Math.abs(predictor - above);
  const upperLeftDistance = Math.abs(predictor - upperLeft);

  if (leftDistance <= aboveDistance && leftDistance <= upperLeftDistance) {
    return left;
  }

  if (aboveDistance <= upperLeftDistance) {
    return above;
  }

  return upperLeft;
}

function inspectDecodedRgbaPng(parsed, options) {
  const blankPixelRatio = clampRatio(options.blankPixelRatio, 0.997);
  const { width, height, pixels } = parsed;
  const bytesPerPixel = parsed.colorType === 6 ? 4 : 3;
  const stride = width * bytesPerPixel;
  const expectedLength = (stride + 1) * height;

  if (pixels.length < expectedLength) {
    throw new Error("truncated_png_pixels");
  }

  let offset = 0;
  let sampleCount = 0;
  let whiteCount = 0;
  let darkCount = 0;
  let sum = 0;
  let sumSquares = 0;
  let min = 255;
  let max = 0;
  const sampleEvery = Math.max(1, Math.floor((width * height) / 20_000));
  const previous = new Uint8Array(stride);
  const current = new Uint8Array(stride);

  for (let y = 0; y < height; y += 1) {
    const filter = pixels[offset];
    offset += 1;

    for (let x = 0; x < stride; x += 1) {
      const raw = pixels[offset + x];
      const left = x >= bytesPerPixel ? current[x - bytesPerPixel] : 0;
      const above = previous[x] ?? 0;
      const upperLeft = x >= bytesPerPixel ? previous[x - bytesPerPixel] : 0;
      let value;

      if (filter === 0) {
        value = raw;
      } else if (filter === 1) {
        value = raw + left;
      } else if (filter === 2) {
        value = raw + above;
      } else if (filter === 3) {
        value = raw + Math.floor((left + above) / 2);
      } else if (filter === 4) {
        value = raw + paethPredictor(left, above, upperLeft);
      } else {
        throw new Error(`unsupported_png_filter:${filter}`);
      }

      current[x] = value & 0xff;
    }

    for (let x = 0; x < width; x += 1) {
      const pixelIndex = y * width + x;
      if (pixelIndex % sampleEvery !== 0) {
        continue;
      }

      const base = x * bytesPerPixel;
      if (bytesPerPixel === 4 && current[base + 3] < 8) {
        continue;
      }

      const red = current[base];
      const green = current[base + 1];
      const blue = current[base + 2];
      const channelMean = (red + green + blue) / 3;

      sampleCount += 1;
      sum += channelMean;
      sumSquares += channelMean * channelMean;
      min = Math.min(min, red, green, blue);
      max = Math.max(max, red, green, blue);

      if (red >= 248 && green >= 248 && blue >= 248) {
        whiteCount += 1;
      }

      if (red <= 7 && green <= 7 && blue <= 7) {
        darkCount += 1;
      }
    }

    previous.set(current);
    current.fill(0);
    offset += stride;
  }

  const whiteRatio = sampleCount ? whiteCount / sampleCount : 1;
  const darkRatio = sampleCount ? darkCount / sampleCount : 1;
  const mean = sampleCount ? sum / sampleCount : 0;
  const variance = sampleCount ? Math.max(0, sumSquares / sampleCount - mean * mean) : 0;
  const channelRange = max - min;
  const uniform = channelRange < 8 && variance < 16;
  const blank = sampleCount === 0 || whiteRatio >= blankPixelRatio || darkRatio >= blankPixelRatio || uniform;

  return {
    blank,
    reason: blank
      ? whiteRatio >= blankPixelRatio
        ? "mostly_white"
        : darkRatio >= blankPixelRatio
          ? "mostly_dark"
          : uniform
            ? "near_uniform"
            : "no_visible_pixels"
      : "contentful",
    width,
    height,
    sampleCount,
    whiteRatio: Math.round(whiteRatio * 10_000) / 10_000,
    darkRatio: Math.round(darkRatio * 10_000) / 10_000,
    channelRange,
    variance: Math.round(variance * 10) / 10,
  };
}

export function inspectPngScreenshot(filePath, options = {}) {
  try {
    const parsed = parsePng(filePath);
    if (parsed.bitDepth !== 8 || ![2, 6].includes(parsed.colorType)) {
      return {
        blank: false,
        reason: `unsupported_png_format:${parsed.bitDepth}:${parsed.colorType}`,
        width: parsed.width,
        height: parsed.height,
      };
    }

    return inspectDecodedRgbaPng(parsed, options);
  } catch (error) {
    if (error instanceof Error && error.message === "not_png") {
      try {
        const dimensions = parseJpegDimensions(filePath);
        const converted = inspectJpegViaSips(filePath, options);

        if (converted) {
          return converted;
        }

        return {
          blank: false,
          reason: "jpeg_dimensions_only",
          imageType: "jpeg",
          width: dimensions.width,
          height: dimensions.height,
        };
      } catch (jpegError) {
        return {
          blank: false,
          reason: "probe_failed",
          error: jpegError instanceof Error ? jpegError.message : String(jpegError),
        };
      }
    }

    return {
      blank: false,
      reason: "probe_failed",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
