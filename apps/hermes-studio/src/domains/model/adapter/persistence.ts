import {
  DESKTOP_MODELS_FILE,
  DESKTOP_MODELS_SCHEMA_VERSION,
  type DesktopModelsFile,
  type FsAdapter,
} from './types.js';

const TEMP_PATH = `${DESKTOP_MODELS_FILE}.tmp`;

function emptyFile(): DesktopModelsFile {
  return { version: DESKTOP_MODELS_SCHEMA_VERSION, providers: {} };
}

export async function readDesktopJson(fs: FsAdapter): Promise<DesktopModelsFile> {
  const text = await fs.readText(DESKTOP_MODELS_FILE);
  if (text === null || text.trim() === '') return emptyFile();
  try {
    const parsed = JSON.parse(text) as Partial<DesktopModelsFile>;
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      parsed.version === DESKTOP_MODELS_SCHEMA_VERSION &&
      typeof parsed.providers === 'object' &&
      parsed.providers !== null
    ) {
      return parsed as DesktopModelsFile;
    }
    throw new Error('schema mismatch');
  } catch {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backup = `${DESKTOP_MODELS_FILE}.broken-${stamp}`;
    try {
      await fs.rename(DESKTOP_MODELS_FILE, backup);
    } catch {
      // best-effort
    }
    return emptyFile();
  }
}

export async function writeDesktopJsonAtomic(
  fs: FsAdapter,
  data: DesktopModelsFile,
): Promise<void> {
  const json = JSON.stringify(data, null, 2);
  await fs.writeText(TEMP_PATH, json);
  await fs.rename(TEMP_PATH, DESKTOP_MODELS_FILE);
}
