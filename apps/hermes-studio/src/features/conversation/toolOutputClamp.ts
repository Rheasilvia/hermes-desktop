export const MAX_TOOL_RENDER_CHARS = 20_000;

export function clampForDisplay(value: string, max = MAX_TOOL_RENDER_CHARS): string {
  if (value.length <= max) return value;

  const omitted = value.length - max;
  return `${value.slice(0, max)}\n\n... ${omitted.toLocaleString()} more characters truncated - use Copy for the full output.`;
}
