export const DEFAULT_SELECTED_POST_COUNT = 7;
export const MAX_SELECTED_POST_COUNT = 25;

export function selectedPostCountFromEnv(env: Record<string, string | undefined>): number {
  const parsed = Number(env.SELECTED_POST_COUNT ?? DEFAULT_SELECTED_POST_COUNT);

  if (!Number.isFinite(parsed)) {
    return DEFAULT_SELECTED_POST_COUNT;
  }

  return Math.max(1, Math.min(MAX_SELECTED_POST_COUNT, Math.floor(parsed)));
}
