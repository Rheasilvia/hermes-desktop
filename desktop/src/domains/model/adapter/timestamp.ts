export function isoToEpoch(iso: string | null | undefined): number {
  if (!iso) return 0;
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return 0;
  return Math.floor(ms / 1000);
}

export function nowIso(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
}

export function isYamlNewer(yamlMtimeSeconds: number, desktopIso: string | null | undefined): boolean {
  return yamlMtimeSeconds > isoToEpoch(desktopIso);
}
