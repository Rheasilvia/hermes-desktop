export { ModelAdapter } from './adapter/index.js';
export { TauriFsAdapter, MemoryFsAdapter } from './adapter/fs-adapter.js';
export type { FsAdapter, UpsertInput, DesktopProviderRecord, SetActiveModelResult, FallbackTarget } from './adapter/types.js';
export { modelStore, modelsStore, BUILT_IN_PROVIDERS } from '@/stores/models.js';
export type { ModelView, BuiltInProvider, CatalogProvider } from '@/stores/models.js';
