/**
 * Gateway dependency injection for stores.
 * Provides a module-level setter to initialize stores with a gateway adapter.
 */

import type { GatewayAdapter } from '@/services/gateway/types.js';
import { ModelAdapter, TauriFsAdapter, MemoryFsAdapter } from '@/domains/model/index.js';
import { BUILT_IN_PROVIDERS } from './models.js';
import { isTauri } from '@tauri-apps/api/core';

let _gateway: GatewayAdapter | null = null;
let _modelAdapter: ModelAdapter | null = null;

/**
 * Initialize all stores with a gateway adapter.
 * Call this once after the gateway is connected.
 */
export function initializeStores(gateway: GatewayAdapter): void {
  _gateway = gateway;
  resetModelAdapter();
}

/**
 * Get the current gateway adapter.
 * Returns null if stores haven't been initialized yet.
 */
export function getGateway(): GatewayAdapter | null {
  return _gateway;
}

/**
 * Get the ModelAdapter singleton.
 * Returns null if stores haven't been initialized yet.
 */
export function getModelAdapter(): ModelAdapter | null {
  if (_modelAdapter) return _modelAdapter;
  const gw = getGateway();
  if (!gw) return null;
  _modelAdapter = new ModelAdapter(
    gw,
    isTauri() ? new TauriFsAdapter() : new MemoryFsAdapter(),
    BUILT_IN_PROVIDERS.map(p => p.name.toLowerCase()),
  );
  return _modelAdapter;
}

export function resetModelAdapter(): void {
  _modelAdapter = null;
}

/**
 * Check if stores have been initialized with a gateway.
 */
export function areStoresInitialized(): boolean {
  return _gateway !== null;
}
