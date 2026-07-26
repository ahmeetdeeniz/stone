import { ValidationError } from "./errors.js";
import type { ThemePreference, UserSettings } from "./entities.js";

const themes: readonly ThemePreference[] = ["system", "light", "dark"];

export function validateThemePreference(value: string): ThemePreference {
  if (!themes.includes(value as ThemePreference)) {
    throw new ValidationError("Theme preference is invalid.");
  }

  return value as ThemePreference;
}

export function validateSettings(settings: UserSettings): UserSettings {
  validateThemePreference(settings.theme);
  if (
    !Number.isInteger(settings.editorFontSize) ||
    settings.editorFontSize < 12 ||
    settings.editorFontSize > 32
  ) {
    throw new ValidationError("Editor font size is outside the supported range.");
  }
  if (!Number.isInteger(settings.trashRetentionDays) || settings.trashRetentionDays < 1) {
    throw new ValidationError("Trash retention must be a positive whole number.");
  }

  return settings;
}
