import type { SettingsRepository, ThemePreference, UserSettings } from "./entities.js";

export class SettingsUseCases {
  public constructor(private readonly repository: SettingsRepository) {}

  public load(ownerId: string): Promise<UserSettings> {
    return this.repository.get(ownerId);
  }

  public async setTheme(ownerId: string, theme: ThemePreference): Promise<UserSettings> {
    const current = await this.repository.get(ownerId);
    const updated: UserSettings = { ...current, theme };
    await this.repository.save(updated);
    return updated;
  }
}
