/**
 * Desktop notification system.
 * Provides toast-style notifications with document.title flash fallback
 * when Tauri notification plugin is not available.
 */

export type NotificationType = 'tool_complete' | 'background_process' | 'approval_needed' | 'error';

let permissionState: NotificationPermission = 'default';

export async function requestNotificationPermission(): Promise<NotificationPermission> {
  if (typeof Notification === 'undefined') {
    return 'denied';
  }
  if (Notification.permission === 'granted') {
    permissionState = 'granted';
    return 'granted';
  }
  if (Notification.permission === 'denied') {
    permissionState = 'denied';
    return 'denied';
  }
  const result = await Notification.requestPermission();
  permissionState = result;
  return result;
}

function getPermission(): NotificationPermission {
  if (typeof Notification !== 'undefined') {
    return Notification.permission;
  }
  return permissionState;
}

/**
 * Show a desktop notification.
 * Uses native Notification API when available and permitted.
 * Falls back to document.title flash for attention.
 */
export function notify(type: NotificationType, title: string, message: string): void {
  const permission = getPermission();

  if (permission === 'granted') {
    const notification = new Notification(title, {
      body: message,
      silent: false,
    });
    notification.onclick = () => {
      window.focus();
      notification.close();
    };
    setTimeout(() => notification.close(), 5000);
    return;
  }

  // Fallback: flash document.title
  flashTitle(`${title}: ${message}`);
}

function flashTitle(text: string): void {
  const original = document.title;
  const words = text.split(' ');
  let index = 0;
  const interval = setInterval(() => {
    const parts = text.split(' ');
    document.title = parts.slice(0, index + 1).join(' ');
    index = (index + 1) % (parts.length + 1);
    if (index === 0) {
      document.title = original;
      clearInterval(interval);
    }
  }, 800);
  setTimeout(() => {
    clearInterval(interval);
    document.title = original;
  }, 6000);
}
