import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { Alert, ScrollView, StyleSheet, View } from "react-native";
import { formatInstant } from "@stone/i18n";
import { ResponsiveContent } from "../../src/components/responsive";
import {
  IconButton,
  Overline,
  Screen,
  StoneButton,
  StoneInput,
  StoneText,
  Surface,
} from "../../src/components/ui";
import { spacing } from "../../src/design/tokens";
import { useI18n } from "../../src/i18n/provider";
import { useAppServices } from "../../src/providers/app-provider";
import { useAuth } from "../../src/providers/auth-provider";
import { calendarSubscriptions } from "../../src/calendar/subscription-service";
import type { CalendarSubscription } from "../../src/calendar/subscriptions";

const errorKeys = {
  invalid_url: "subscriptions.invalidUrl",
  https_required: "subscriptions.httpsRequired",
  already_subscribed: "subscriptions.alreadySubscribed",
  too_many_subscriptions: "subscriptions.tooMany",
} as const;

/** Add, refresh and remove read-only iCalendar feeds kept on this device. */
export default function CalendarSubscriptionsScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const { deviceId } = useAppServices();
  const { t, locale } = useI18n();
  const [subscriptions, setSubscriptions] = useState<readonly CalendarSubscription[]>([]);
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";

  const load = useCallback(async () => {
    if (user) setSubscriptions(await calendarSubscriptions.list(user.uid));
  }, [user]);
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const describeError = (error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    return message in errorKeys ? t(errorKeys[message as keyof typeof errorKeys]) : message;
  };

  const add = async () => {
    if (!user || !url.trim()) return;
    setBusy(true);
    try {
      const added = await calendarSubscriptions.add(
        user.uid,
        { name, url },
        { deviceId, timezone, now: new Date().toISOString() },
      );
      setName("");
      setUrl("");
      await load();
      Alert.alert(
        t("subscriptions.added"),
        t("subscriptions.addedDetail", { count: added.items.length, skipped: added.skipped }),
      );
    } catch (error) {
      Alert.alert(t("subscriptions.addFailed"), describeError(error));
    } finally {
      setBusy(false);
    }
  };

  const refreshAll = async () => {
    if (!user) return;
    setBusy(true);
    try {
      setSubscriptions(
        await calendarSubscriptions.refresh(
          user.uid,
          { deviceId, timezone, now: new Date().toISOString() },
          true,
        ),
      );
    } finally {
      setBusy(false);
    }
  };

  const remove = (subscription: CalendarSubscription) => {
    if (!user) return;
    Alert.alert(t("subscriptions.removeConfirm", { name: subscription.name }), undefined, [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("subscriptions.remove"),
        style: "destructive",
        onPress: () => void calendarSubscriptions.remove(user.uid, subscription.id).then(load),
      },
    ]);
  };

  return (
    <Screen>
      <ResponsiveContent>
        <View style={styles.header}>
          <IconButton
            icon="chevron-back"
            accessibilityLabel={t("common.back")}
            onPress={() => router.back()}
          />
          <StoneText variant="title1">{t("subscriptions.title")}</StoneText>
        </View>
        <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
          <StoneText variant="bodySmall" tone="secondary">
            {t("subscriptions.description")}
          </StoneText>
          <Surface>
            <StoneInput
              label={t("subscriptions.name")}
              value={name}
              onChangeText={setName}
              placeholder={t("subscriptions.namePlaceholder")}
            />
            <StoneInput
              label={t("subscriptions.url")}
              value={url}
              onChangeText={setUrl}
              placeholder={t("subscriptions.urlPlaceholder")}
              autoCapitalize="none"
              keyboardType="url"
            />
            <StoneButton
              label={t("subscriptions.add")}
              icon="add"
              onPress={() => void add()}
              disabled={busy || !url.trim()}
            />
          </Surface>

          {subscriptions.length > 0 ? (
            <>
              <View style={styles.listHeader}>
                <Overline>{t("subscriptions.list")}</Overline>
                <StoneButton
                  label={t("subscriptions.refresh")}
                  variant="quiet"
                  size="sm"
                  icon="refresh"
                  onPress={() => void refreshAll()}
                  disabled={busy}
                />
              </View>
              {subscriptions.map((subscription) => (
                <Surface key={subscription.id}>
                  <View style={styles.row}>
                    <View style={styles.rowText}>
                      <StoneText variant="title3" numberOfLines={1}>
                        {subscription.name}
                      </StoneText>
                      <StoneText variant="caption" tone="secondary" numberOfLines={1}>
                        {new URL(subscription.url).hostname}
                      </StoneText>
                      <StoneText variant="caption" tone="secondary">
                        {t("subscriptions.status", {
                          count: subscription.items.length,
                          when: subscription.lastFetchedAt
                            ? formatInstant(locale, subscription.lastFetchedAt, timezone)
                            : "—",
                        })}
                      </StoneText>
                      {subscription.lastError ? (
                        <StoneText variant="caption" tone="danger">
                          {t("subscriptions.lastError", { error: subscription.lastError })}
                        </StoneText>
                      ) : null}
                    </View>
                    <IconButton
                      icon="trash-outline"
                      accessibilityLabel={t("subscriptions.remove")}
                      onPress={() => remove(subscription)}
                    />
                  </View>
                </Surface>
              ))}
            </>
          ) : null}
        </ScrollView>
      </ResponsiveContent>
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingVertical: spacing.md,
  },
  page: { gap: spacing.md, paddingBottom: spacing.giant },
  listHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  rowText: { flex: 1, gap: 2 },
});
