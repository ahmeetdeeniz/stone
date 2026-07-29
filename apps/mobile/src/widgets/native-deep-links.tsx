import * as Linking from "expo-linking";
import { useRouter } from "expo-router";
import { useEffect, useRef } from "react";
import { parseStoneDeepLink, type StoneDeepLink } from "@stone/widgets";
import { useAuth } from "../providers/auth-provider";

export function NativeDeepLinkRouter() {
  const router = useRouter();
  const { status, user } = useAuth();
  const pending = useRef<string | null>(null);

  useEffect(() => {
    const accept = (url: string | null) => {
      if (!url || !url.startsWith("stone://")) return;
      pending.current = url;
      if (status !== "ready" || !user) return;
      const parsed = parseStoneDeepLink(url);
      if (!parsed) {
        pending.current = null;
        router.replace("/(tabs)/notes");
        return;
      }
      pending.current = null;
      route(router, parsed);
    };
    void Linking.getInitialURL().then(accept);
    const subscription = Linking.addEventListener("url", ({ url }) => accept(url));
    if (pending.current) accept(pending.current);
    return () => subscription.remove();
  }, [router, status, user]);

  return null;
}

function route(router: ReturnType<typeof useRouter>, link: StoneDeepLink): void {
  switch (link.route) {
    case "today":
      router.replace("/(tabs)/today");
      return;
    case "focus":
      router.replace("/(tabs)/focus");
      return;
    case "new_task":
      router.replace({ pathname: "/task/[id]", params: { id: "new" } });
      return;
    case "new_note":
      router.replace("/(tabs)/notes");
      return;
    case "new_event":
      router.replace({ pathname: "/calendar/[id]", params: { id: "new" } });
      return;
    case "task":
      router.replace({ pathname: "/task/[id]", params: { id: link.id } });
      return;
    case "project":
      router.replace({ pathname: "/project/[id]", params: { id: link.id } });
      return;
    case "calendar_date":
      router.replace({
        pathname: "/(tabs)/calendar",
        params: { date: link.date },
      });
      return;
    case "calendar_event":
      router.replace({ pathname: "/calendar/[id]", params: { id: link.id } });
  }
}
