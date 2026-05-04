/// <reference types="vite/client" />

import * as TauriCore from '@tauri-apps/api/core';
import * as TauriApp from '@tauri-apps/api/app';
import * as TauriEvent from '@tauri-apps/api/event';
import * as TauriPath from '@tauri-apps/api/path';
import * as TauriWindow from '@tauri-apps/api/window';
import * as TauriWebview from '@tauri-apps/api/webview';
import * as TauriWebviewWindow from '@tauri-apps/api/webviewWindow';

declare global {
  interface Window {
    __TAURI__?: {
      core: typeof TauriCore;
      app: typeof TauriApp;
      event: typeof TauriEvent;
      path: typeof TauriPath;
      window: typeof TauriWindow;
      webview: typeof TauriWebview;
      webviewWindow: typeof TauriWebviewWindow;
    };
  }
}
