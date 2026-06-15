export const X_TIMELINE_ENDPOINT = "/2/users/:id/timelines/reverse_chronological";
export const X_TWEET_LOOKUP_ENDPOINT = "/2/tweets";

export const X_READER_EXPANSIONS = [
  "author_id",
  "referenced_tweets.id",
  "referenced_tweets.id.author_id",
  "referenced_tweets.id.attachments.media_keys",
  "attachments.media_keys",
  "attachments.poll_ids",
  "geo.place_id",
  "in_reply_to_user_id",
  "entities.mentions.username",
].join(",");

export const X_READER_TWEET_FIELDS = [
  "attachments",
  "author_id",
  "context_annotations",
  "conversation_id",
  "created_at",
  "edit_controls",
  "edit_history_tweet_ids",
  "entities",
  "geo",
  "id",
  "in_reply_to_user_id",
  "lang",
  "possibly_sensitive",
  "public_metrics",
  "referenced_tweets",
  "reply_settings",
  "source",
  "text",
  "withheld",
  "note_tweet",
].join(",");

export const X_READER_USER_FIELDS = [
  "created_at",
  "description",
  "entities",
  "id",
  "location",
  "name",
  "pinned_tweet_id",
  "profile_banner_url",
  "profile_image_url",
  "protected",
  "public_metrics",
  "url",
  "username",
  "verified",
  "verified_type",
  "withheld",
].join(",");

export const X_READER_MEDIA_FIELDS = [
  "alt_text",
  "duration_ms",
  "height",
  "media_key",
  "preview_image_url",
  "public_metrics",
  "type",
  "url",
  "variants",
  "width",
].join(",");
