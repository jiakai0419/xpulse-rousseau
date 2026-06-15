export type XApiPost = {
  id: string;
  text: string;
  author_id?: string;
  created_at?: string;
  lang?: string;
  attachments?: {
    media_keys?: string[];
  };
  entities?: {
    urls?: XApiUrlEntity[];
  };
  note_tweet?: {
    text?: string;
    entities?: {
      urls?: XApiUrlEntity[];
    };
  };
  public_metrics?: {
    reply_count?: number;
    retweet_count?: number;
    like_count?: number;
    quote_count?: number;
    impression_count?: number;
  };
  referenced_tweets?: Array<{
    type: "retweeted" | "quoted" | "replied_to";
    id: string;
  }>;
};

export type XApiUrlEntity = {
  url: string;
  expanded_url?: string;
  display_url?: string;
  unwound_url?: string;
  media_key?: string;
  title?: string;
  description?: string;
  images?: Array<{
    url?: string;
    width?: number;
    height?: number;
  }>;
};

export type XApiUser = {
  id: string;
  name: string;
  username: string;
  profile_image_url?: string;
};

export type XApiMedia = {
  media_key: string;
  type: "photo" | "video" | "animated_gif";
  url?: string;
  preview_image_url?: string;
  duration_ms?: number;
  width?: number;
  height?: number;
  alt_text?: string;
  variants?: Array<{
    bit_rate?: number;
    content_type?: string;
    url?: string;
  }>;
};

export type XTimelineResponse = {
  data?: XApiPost[];
  includes?: {
    tweets?: XApiPost[];
    users?: XApiUser[];
    media?: XApiMedia[];
  };
  meta?: {
    next_token?: string;
    result_count?: number;
  };
};

export type XMeResponse = {
  data?: XApiUser;
};
