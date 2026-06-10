export function readerDisplayPost(post) {
  if (post?.referencedPostType === "retweeted" && post.referencedPost) {
    return post.referencedPost;
  }

  return post;
}

export function repostContextDisplay(post) {
  if (post?.referencedPostType !== "retweeted" || !post.referencedPost) {
    return undefined;
  }

  const authorName = post.author?.name?.trim() || post.author?.username?.trim() || "";
  return {
    authorName,
    label: `${authorName} reposted`,
  };
}
