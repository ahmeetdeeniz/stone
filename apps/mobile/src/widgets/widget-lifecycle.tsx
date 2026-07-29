import * as SecureStore from "expo-secure-store";
import { useCallback, useEffect } from "react";
import { AppState } from "react-native";
import type { WidgetPrivacy } from "@stone/widgets";
import { useI18n } from "../i18n/provider";
import { useAuth } from "../providers/auth-provider";
import { useAppServices } from "../providers/app-provider";
import { clearWidgetsForAccountLifecycle, refreshNativeWidgets } from "./snapshot";

export const WIDGET_PRIVACY_KEY = "stone.widgets.privacy.v1";

export async function readWidgetPrivacy(): Promise<WidgetPrivacy> {
  const stored = await SecureStore.getItemAsync(WIDGET_PRIVACY_KEY);
  return stored === "titles" || stored === "titles_and_context" ? stored : "counts_only";
}

export async function writeWidgetPrivacy(value: WidgetPrivacy): Promise<void> {
  await SecureStore.setItemAsync(WIDGET_PRIVACY_KEY, value);
}

export function WidgetLifecycle() {
  const services = useAppServices();
  const { user, status } = useAuth();
  const { locale, ready } = useI18n();
  const refresh = useCallback(async () => {
    if (!user || !ready) return;
    await refreshNativeWidgets(services, user.uid, locale, await readWidgetPrivacy());
  }, [locale, ready, services, user]);

  useEffect(() => {
    if (status !== "ready") return;
    if (!user) void clearWidgetsForAccountLifecycle();
    else void refresh();
  }, [refresh, status, user]);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") void refresh();
    });
    return () => subscription.remove();
  }, [refresh]);

  return null;
}
