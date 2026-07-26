export const STUDIO_APP_ID = 'com.hermes-agent.studio'

export interface AppIdentityLike {
  setAppUserModelId(id: string): void
}

export function configureEarlyAppIdentity(
  app: AppIdentityLike,
  platform: NodeJS.Platform = process.platform,
): void {
  if (platform === 'win32') app.setAppUserModelId(STUDIO_APP_ID)
}
