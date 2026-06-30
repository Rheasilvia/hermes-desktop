const PLAN_CARD_MAX_LINES = 8;
const PLAN_CARD_MAX_CHARS = 720;

export function buildPlanCardPreview(content: string): string {
  const normalized = content.replace(/\r\n?/g, '\n').trim();
  if (!normalized) return '';

  const lines: string[] = [];
  let usedChars = 0;
  let truncated = false;

  for (const line of normalized.split('\n')) {
    if (lines.length >= PLAN_CARD_MAX_LINES || usedChars >= PLAN_CARD_MAX_CHARS) {
      truncated = true;
      break;
    }

    const remaining = PLAN_CARD_MAX_CHARS - usedChars;
    if (line.length > remaining) {
      lines.push(line.slice(0, Math.max(0, remaining)).trimEnd());
      truncated = true;
      break;
    }

    lines.push(line);
    usedChars += line.length + 1;
  }

  const preview = lines.join('\n').trim();
  return truncated ? `${preview}\n\n...` : preview;
}
