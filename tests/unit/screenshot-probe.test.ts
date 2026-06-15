import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import assert from "node:assert/strict";
import { inspectPngScreenshot } from "../../scripts/screenshot-probe.mjs";

function chunk(type: string, data: Buffer) {
  const header = Buffer.alloc(8);
  header.writeUInt32BE(data.length, 0);
  header.write(type, 4, 4, "ascii");
  return Buffer.concat([header, data, Buffer.alloc(4)]);
}

function png(width: number, height: number, pixel: (x: number, y: number) => [number, number, number, number]) {
  const bytesPerPixel = 4;
  const stride = width * bytesPerPixel;
  const raw = Buffer.alloc((stride + 1) * height);

  for (let y = 0; y < height; y += 1) {
    const rowOffset = y * (stride + 1);
    raw[rowOffset] = 0;

    for (let x = 0; x < width; x += 1) {
      const [red, green, blue, alpha] = pixel(x, y);
      const offset = rowOffset + 1 + x * bytesPerPixel;
      raw[offset] = red;
      raw[offset + 1] = green;
      raw[offset + 2] = blue;
      raw[offset + 3] = alpha;
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;

  return Buffer.concat([
    Buffer.from("89504e470d0a1a0a", "hex"),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function writePng(name: string, buffer: Buffer) {
  const dir = join(tmpdir(), "xpulse-screenshot-probe");
  mkdirSync(dir, { recursive: true });
  const filePath = join(dir, `${name}-${Date.now()}-${Math.random().toString(16).slice(2)}.png`);
  writeFileSync(filePath, buffer);
  return filePath;
}

function writeImage(name: string, extension: string, buffer: Buffer) {
  const dir = join(tmpdir(), "xpulse-screenshot-probe");
  mkdirSync(dir, { recursive: true });
  const filePath = join(dir, `${name}-${Date.now()}-${Math.random().toString(16).slice(2)}.${extension}`);
  writeFileSync(filePath, buffer);
  return filePath;
}

function minimalJpegWithDimensions(width: number, height: number) {
  const app0 = Buffer.concat([
    Buffer.from([0xff, 0xe0, 0x00, 0x10]),
    Buffer.from("JFIF\0", "binary"),
    Buffer.from([0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00]),
  ]);
  const sof0 = Buffer.alloc(19);
  sof0[0] = 0xff;
  sof0[1] = 0xc0;
  sof0.writeUInt16BE(17, 2);
  sof0[4] = 8;
  sof0.writeUInt16BE(height, 5);
  sof0.writeUInt16BE(width, 7);
  sof0[9] = 3;
  sof0.set([1, 0x11, 0, 2, 0x11, 0, 3, 0x11, 0], 10);

  return Buffer.concat([Buffer.from([0xff, 0xd8]), app0, sof0, Buffer.from([0xff, 0xd9])]);
}

test("marks a uniform white screenshot as blank", () => {
  const filePath = writePng("white", png(80, 60, () => [255, 255, 255, 255]));
  const result = inspectPngScreenshot(filePath);

  assert.equal(result.blank, true);
  assert.equal(result.reason, "mostly_white");
});

test("marks a uniform dark screenshot as blank", () => {
  const filePath = writePng("dark", png(80, 60, () => [0, 0, 0, 255]));
  const result = inspectPngScreenshot(filePath);

  assert.equal(result.blank, true);
  assert.equal(result.reason, "mostly_dark");
});

test("marks a high-contrast screenshot as contentful", () => {
  const filePath = writePng(
    "content",
    png(80, 60, (x, y) => (x > 12 && x < 68 && y > 14 && y < 46 ? [20, 80, 140, 255] : [255, 255, 255, 255])),
  );
  const result = inspectPngScreenshot(filePath);

  assert.equal(result.blank, false);
  assert.equal(result.reason, "contentful");
});

test("recognizes JPEG screenshots instead of reporting not_png probe failure", () => {
  const filePath = writeImage("jpeg", "jpg", minimalJpegWithDimensions(320, 180));
  const result = inspectPngScreenshot(filePath);

  assert.equal(result.blank, false);
  assert.equal(result.imageType, "jpeg");
  assert.equal(result.width, 320);
  assert.equal(result.height, 180);
});
