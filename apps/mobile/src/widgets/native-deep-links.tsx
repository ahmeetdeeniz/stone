import * as Linking from "expo-linking";
import { useRootNavigationState, useRouter } from "expo-router";
import { useEffect, useRef } from "react";
import { parseStoneDeepLink, type StoneDeepLink } from "@stone/widgets";
import { useAuth } from "../providers/auth-provider";

/**
 * True once the root navigator has mounted. Navigating earlier (a widget or notification
 * cold-starting the app while fonts or services are still loading) throws in expo-router.
 */
export function useNavigationReady(): boolean {
  const state = useRootNavigationState() as { key?: string } | undefined;
  return Boolean(state?.key);
}

export function NativeDeepLinkRouter() {
  const router = useRouter();
  const { status, user } = useAuth();
  const navigationReady = useNavigationReady();
  const pending = useRef<string | null>(null);
  const initialRead = useRef(false);

  useEffect(() => {
    const accept = (url: string | null) => {
      if (!url || !url.startsWith("stone://")) return;
      pending.current = url;
      if (status !== "ready" || !user || !navigationReady) return;
      const parsed = parseStoneDeepLink(url);
      if (!parsed) {
        pending.current = null;
        router.replace("/(tabs)/notes");
        return;
      }
      pending.current = null;
      route(router, parsed);
    };
    // The launch URL is read once; re-reading it whenever auth or navigation state changes would
    // navigate to it again.
    if (!initialRead.current) {
      initialRead.current = true;
      void Linking.getInitialURL().then(accept);
    }
    const subscription = Linking.addEventListener("url", ({ url }) => accept(url));
    if (pending.current) accept(pending.current);
    return () => subscription.remove();
  }, [navigationReady, router, status, user]);

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
