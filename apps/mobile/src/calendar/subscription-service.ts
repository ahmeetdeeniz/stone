import * as Crypto from "expo-crypto";
import { File, Paths } from "expo-file-system";
import { createSubscriptionService, fetchIcsFeed } from "./subscriptions";

const file = () => new File(Paths.document, "calendar-subscriptions.json");

/** The app's subscription service: JSON in the documents directory, never synced. */
export const calendarSubscriptions = createSubscriptionService({
  store: {
    read: async () => {
      const target = file();
      return target.exists ? await target.text() : null;
    },
    write: (content) => {
      file().write(content);
      return Promise.resolve();
    },
  },
  fetchFeed: (url) => fetchIcsFeed(url),
  newId: () => Crypto.randomUUID(),
});
