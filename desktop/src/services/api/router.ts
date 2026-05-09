import type { AnalyticsTransport } from './transports/http/analytics';
import type { CronTransport } from './transports/http/cron';
import type { ModelTransport } from './transports/http/model';
import type { OverlayTransport } from './transports/http/overlays';
import type { PluginsTransport } from './transports/http/plugins';
import type { SettingsTransport } from './transports/http/settings';
import type { SkillsTransport } from './transports/http/skills';
import type { StateTransport } from './transports/http/state';

type Slot =
  | { kind: 'analytics'; impl: AnalyticsTransport }
  | { kind: 'cron'; impl: CronTransport }
  | { kind: 'model'; impl: ModelTransport }
  | { kind: 'overlays'; impl: OverlayTransport }
  | { kind: 'plugins'; impl: PluginsTransport }
  | { kind: 'settings'; impl: SettingsTransport }
  | { kind: 'skills'; impl: SkillsTransport }
  | { kind: 'state'; impl: StateTransport };

export class ApiRegistry {
  private slots: Map<Slot['kind'], unknown> = new Map();

  register<K extends Slot['kind']>(
    kind: K,
    impl: Extract<Slot, { kind: K }>['impl'],
  ): void {
    this.slots.set(kind, impl);
  }

  private resolve<T>(kind: Slot['kind']): T {
    const v = this.slots.get(kind);
    if (!v) throw new Error(`No transport registered for ${kind}`);
    return v as T;
  }

  analytics(): AnalyticsTransport {
    return this.resolve<AnalyticsTransport>('analytics');
  }
  cron(): CronTransport {
    return this.resolve<CronTransport>('cron');
  }
  model(): ModelTransport {
    return this.resolve<ModelTransport>('model');
  }
  overlays(): OverlayTransport {
    return this.resolve<OverlayTransport>('overlays');
  }
  plugins(): PluginsTransport {
    return this.resolve<PluginsTransport>('plugins');
  }
  settings(): SettingsTransport {
    return this.resolve<SettingsTransport>('settings');
  }
  skills(): SkillsTransport {
    return this.resolve<SkillsTransport>('skills');
  }
  state(): StateTransport {
    return this.resolve<StateTransport>('state');
  }
}

export const api = new ApiRegistry();
