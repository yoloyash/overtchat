import type { ReactNode } from "react";
import { Redirect } from "expo-router";
import { ActivityIndicator } from "react-native";
import { getAuthClient } from "@/lib/auth/client";
export function AdminGate({ children }: { children: ReactNode }) {
  const session = getAuthClient().useSession();
  if (session.isPending) return <ActivityIndicator />;
  if (session.data?.user.role !== "admin") return <Redirect href="/settings" />;
  return children;
}
