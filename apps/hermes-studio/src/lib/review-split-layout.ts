export const REVIEW_FILE_RAIL_DEFAULT_WIDTH = 304;
export const REVIEW_FILE_RAIL_MIN_WIDTH = 248;
export const REVIEW_FILE_RAIL_MAX_WIDTH = 400;
export const REVIEW_DIFF_MIN_WIDTH = 456;
export const REVIEW_SPLIT_HANDLE_WIDTH = 8;

export const REVIEW_SPLIT_MIN_WIDTH =
  REVIEW_DIFF_MIN_WIDTH + REVIEW_FILE_RAIL_MIN_WIDTH + REVIEW_SPLIT_HANDLE_WIDTH;

const finiteOrDefault = (value: number, fallback: number) =>
  Number.isFinite(value) ? value : fallback;

export function shouldUseReviewSplit(containerWidth: number): boolean {
  return finiteOrDefault(containerWidth, 0) >= REVIEW_SPLIT_MIN_WIDTH;
}

export function maxReviewFileRailWidth(containerWidth: number): number {
  const safeContainerWidth = Math.max(0, finiteOrDefault(containerWidth, 0));
  const maxByDiffPane = safeContainerWidth - REVIEW_DIFF_MIN_WIDTH - REVIEW_SPLIT_HANDLE_WIDTH;
  return Math.max(
    REVIEW_FILE_RAIL_MIN_WIDTH,
    Math.min(REVIEW_FILE_RAIL_MAX_WIDTH, maxByDiffPane),
  );
}

export function clampReviewFileRailWidth(candidateWidth: number, containerWidth: number): number {
  const requestedWidth = finiteOrDefault(candidateWidth, REVIEW_FILE_RAIL_DEFAULT_WIDTH);
  return Math.round(
    Math.min(
      Math.max(requestedWidth, REVIEW_FILE_RAIL_MIN_WIDTH),
      maxReviewFileRailWidth(containerWidth),
    ),
  );
}
