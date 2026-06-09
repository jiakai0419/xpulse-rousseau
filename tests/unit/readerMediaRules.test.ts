import assert from "node:assert/strict";
import { test } from "node:test";
import {
  formatMediaDuration,
  fullSizeMediaUrl,
  mediaAspectRatio,
  mediaAspectRatioValue,
  mediaGalleryAspectRatio,
  mediaVideoUrl,
  proxiedVideoUrl,
  singleMediaWidth,
  variantDimensions,
  variantFitsInline,
} from "../../public/reader/mediaRules.js";

test("proxiedVideoUrl proxies only video.twimg.com URLs", () => {
  const xVideo = "https://video.twimg.com/amplify_video/1/vid/avc1/1280x720/demo.mp4";
  const otherVideo = "https://cdn.example.com/video.mp4";

  assert.equal(proxiedVideoUrl(xVideo), `/api/media/proxy?url=${encodeURIComponent(xVideo)}`);
  assert.equal(proxiedVideoUrl(otherVideo), otherVideo);
  assert.equal(proxiedVideoUrl(""), "");
});

test("mediaVideoUrl prefers playable inline-fitting mp4 variants", () => {
  const hugeVariant = {
    url: "https://video.twimg.com/ext_tw_video/1/vid/avc1/3840x2160/huge.mp4",
    contentType: "video/mp4",
    bitRate: 20000000,
  };
  const inlineVariant = {
    url: "https://video.twimg.com/ext_tw_video/1/vid/avc1/1280x720/inline.mp4",
    contentType: "video/mp4",
    bitRate: 8000000,
  };
  const m3u8Variant = {
    url: "https://video.twimg.com/ext_tw_video/1/pl/playlist.m3u8",
    contentType: "application/x-mpegURL",
  };

  assert.equal(mediaVideoUrl({ variants: [hugeVariant, m3u8Variant, inlineVariant] }), inlineVariant.url);
});

test("variantDimensions and variantFitsInline read X video variant shape", () => {
  const size = variantDimensions("https://video.twimg.com/ext_tw_video/1/vid/avc1/1920x1080/demo.mp4");

  assert.deepEqual(size, { width: 1920, height: 1080 });
  assert.equal(variantFitsInline({ bitRate: 12000000 }, size), true);
  assert.equal(variantFitsInline({ bitRate: 13000000 }, size), false);
  assert.equal(
    variantFitsInline({ bitRate: 0 }, variantDimensions("https://video.twimg.com/ext_tw_video/1/vid/avc1/2560x1440/demo.mp4")),
    false,
  );
});

test("fullSizeMediaUrl requests original pbs.twimg.com photo size", () => {
  assert.equal(
    fullSizeMediaUrl({
      type: "photo",
      url: "https://pbs.twimg.com/media/ABC123.jpg",
    }),
    "https://pbs.twimg.com/media/ABC123.jpg?format=jpg&name=orig",
  );
  assert.equal(
    fullSizeMediaUrl({
      type: "video",
      previewImageUrl: "https://pbs.twimg.com/ext_tw_video_thumb/ABC/img/demo.jpg",
    }),
    "https://pbs.twimg.com/ext_tw_video_thumb/ABC/img/demo.jpg",
  );
});

test("media aspect ratio helpers preserve source shape and X-like caps", () => {
  const tallPhoto = { type: "photo", width: 800, height: 1600 };
  const widePhoto = { type: "photo", width: 2400, height: 600 };

  assert.equal(mediaAspectRatio(tallPhoto), "800 / 1600");
  assert.equal(mediaAspectRatioValue(tallPhoto), "0.5000");
  assert.equal(singleMediaWidth(tallPhoto), "255px");
  assert.equal(mediaAspectRatioValue(widePhoto), "4.0000");
  assert.equal(singleMediaWidth(widePhoto), "2040px");
});

test("mediaGalleryAspectRatio follows X-like gallery shapes", () => {
  assert.deepEqual(mediaGalleryAspectRatio([{ type: "photo", width: 800, height: 600 }, { type: "photo", width: 600, height: 800 }], 2), {
    css: "16 / 9",
    value: 16 / 9,
  });
  assert.deepEqual(
    mediaGalleryAspectRatio(
      [
        { type: "photo", width: 1600, height: 900 },
        { type: "photo", width: 1400, height: 900 },
        { type: "photo", width: 1200, height: 900 },
      ],
      3,
    ),
    {
      css: "16 / 9",
      value: 16 / 9,
    },
  );
  assert.deepEqual(
    mediaGalleryAspectRatio(
      [
        { type: "photo", width: 600, height: 900 },
        { type: "photo", width: 1400, height: 900 },
        { type: "photo", width: 1200, height: 900 },
      ],
      3,
    ),
    {
      css: "1 / 1",
      value: 1,
    },
  );
});

test("formatMediaDuration renders compact video duration labels", () => {
  assert.equal(formatMediaDuration(0), "");
  assert.equal(formatMediaDuration(999), "0:01");
  assert.equal(formatMediaDuration(125000), "2:05");
});
