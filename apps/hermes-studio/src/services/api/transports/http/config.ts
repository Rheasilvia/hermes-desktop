import type { HttpClient } from '../../http-client';
import type {
  ConfigReadResponse,
  ConfigSaveRequest,
  ConfigSaveResponse,
  ConfigSchemaResponse,
  HermesConfigRecord,
} from '../../types';

export interface ConfigTransport {
  get(): Promise<ConfigReadResponse>;
  defaults(): Promise<HermesConfigRecord>;
  schema(): Promise<ConfigSchemaResponse>;
  put(request: ConfigSaveRequest): Promise<ConfigSaveResponse>;
}

export function makeConfigTransport(c: HttpClient): ConfigTransport {
  return {
    get: () => c.get<ConfigReadResponse>('/desktop/api/config'),
    defaults: () => c.get<HermesConfigRecord>('/desktop/api/config/defaults'),
    schema: () => c.get<ConfigSchemaResponse>('/desktop/api/config/schema'),
    put: (request) => c.put<ConfigSaveResponse>('/desktop/api/config', request),
  };
}
