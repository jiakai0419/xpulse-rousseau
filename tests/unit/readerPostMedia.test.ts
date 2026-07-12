import assert from "node:assert/strict";
import { test } from "node:test";
import { renderPostMedia } from "../../public/reader/postMedia.js";

function post(media: Array<Record<string, unknown>>) {
  return {
    id: "post-1",
    media,
  };
}

test("renderPostMedia returns empty markup when no renderable media exists", () => {
  assert.equal(renderPostMedia(post([])), "");
  assert.equal(renderPostMedia(post([{ type: "photo" }])), "");
  assert.equal(
    renderPostMedia(
      post([
        {
          type: "video",
          previewImageUrl: "https://pbs.twimg.com/ext_tw_video_thumb/1/img/demo.jpg",
          variants: [],
        },
      ]),
    ),
    "",
  );
});

test("renderPostMedia renders a single photo with original-size viewer data", () => {
  const html = renderPostMedia(
    post([
      {
        type: "photo",
        url: "https://pbs.twimg.com/media/ABC123.jpg?name=small",
        width: 1000,
        height: 500,
        altText: "Chart <unsafe>",
      },
    ]),
  );

  assert.match(html, /class="media-grid media-count-1"/);
  assert.match(html, /--single-media-width: 1020px/);
  assert.match(html, /--media-ratio: 1000 \/ 500/);
  assert.match(html, /data-media-index="0"/);
  assert.match(html, /data-media-type="photo"/);
  assert.match(html, /data-media-src="https:\/\/pbs\.twimg\.com\/media\/ABC123\.jpg\?name=small"/);
  assert.match(html, /data-media-full-src="https:\/\/pbs\.twimg\.com\/media\/ABC123\.jpg\?name=orig&amp;format=jpg"/);
  assert.match(html, /data-media-alt="Chart &lt;unsafe&gt;"/);
  assert.match(html, /data-media-caption="Chart &lt;unsafe&gt;"/);
  assert.match(html, /<img src="https:\/\/pbs\.twimg\.com\/media\/ABC123\.jpg\?name=small" alt="Chart &lt;unsafe&gt;" loading="lazy" \/>/);
  assert.doesNotMatch(html, /media-duration/);
});

test("renderPostMedia defers playable video loading and exposes pause and viewer controls", () => {
  const videoUrl = "https://video.twimg.com/ext_tw_video/1/vid/avc1/1280x720/demo.mp4";
  const proxied = `/api/media/proxy?url=${encodeURIComponent(videoUrl)}`;
  const html = renderPostMedia(
    post([
      {
        type: "video",
        previewImageUrl: "https://pbs.twimg.com/ext_tw_video_thumb/1/img/demo.jpg",
        width: 1280,
        height: 720,
        durationMs: 125000,
        variants: [
          {
            url: videoUrl,
            contentType: "video/mp4",
            bitRate: 8000000,
          },
        ],
      },
    ]),
  );

  assert.match(html, /class="media-grid media-count-1 media-single-video"/);
  assert.match(html, new RegExp(`data-media-video-src="${proxied.replaceAll("?", "\\?")}`));
  assert.match(html, new RegExp(`data-inline-video-src="${proxied.replaceAll("?", "\\?")}`));
  assert.match(html, /poster="https:\/\/pbs\.twimg\.com\/ext_tw_video_thumb\/1\/img\/demo\.jpg"/);
  assert.match(html, /muted playsinline controls preload="none"/);
  assert.doesNotMatch(html, /autoplay| loop/);
  assert.match(html, /class="media-button media-video-expand media-viewer-trigger"/);
  assert.doesNotMatch(html, /<video src=/);
  assert.doesNotMatch(html, /preload="auto"/);
  assert.match(html, /aria-label="video media"/);
  assert.match(html, /<span class="media-duration">2:05<\/span>/);
});

test("renderPostMedia only loops animated GIF media", () => {
  const html = renderPostMedia(
    post([
      {
        type: "animated_gif",
        previewImageUrl: "https://pbs.twimg.com/tweet_video_thumb/demo.jpg",
        variants: [{ url: "https://video.twimg.com/tweet_video/demo.mp4", contentType: "video/mp4" }],
      },
    ]),
  );

  assert.match(html, /muted playsinline loop controls preload="none"/);
  assert.doesNotMatch(html, /autoplay/);
});

test("renderPostMedia caps galleries at four media items and keeps X-like grid data stable", () => {
  const html = renderPostMedia(
    post([
      { type: "photo", url: "https://img.example/1.jpg", width: 1600, height: 900 },
      { type: "photo", url: "https://img.example/2.jpg", width: 1400, height: 900 },
      { type: "photo", url: "https://img.example/3.jpg", width: 1200, height: 900 },
      { type: "photo", url: "https://img.example/4.jpg", width: 1300, height: 900 },
      { type: "photo", url: "https://img.example/5.jpg", width: 800, height: 900 },
    ]),
  );

  assert.match(html, /class="media-grid media-count-4"/);
  assert.match(html, /--media-gallery-ratio: 16 \/ 9; --media-gallery-ratio-value: 1\.7778/);
  assert.match(html, /aria-label="Open media 1 of 4"/);
  assert.match(html, /aria-label="Open media 4 of 4"/);
  assert.doesNotMatch(html, /Open media 5 of 4/);
  assert.doesNotMatch(html, /https:\/\/img\.example\/5\.jpg/);
});
