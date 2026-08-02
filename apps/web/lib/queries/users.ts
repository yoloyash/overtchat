"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { userKeys } from "@/lib/queries/keys";

export type UserRole = "user" | "admin";

export type UserRow = {
  id: string;
  email: string;
  name: string;
  role?: string | null;
  createdAt: string | Date;
  banned?: boolean | null;
};

export function useUsers() {
  return useQuery({
    queryKey: userKeys.list(),
    queryFn: async (): Promise<UserRow[]> => {
      const r = await fetch("/api/users");
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const json = (await r.json()) as { users: UserRow[] };
      return json.users;
    },
  });
}

export function useInvalidateUsers() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: userKeys.list() });
}

export function useSetUserRole() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      userId,
      role,
    }: {
      userId: string;
      role: UserRole;
    }): Promise<UserRow> => {
      const response = await fetch(`/api/users/${userId}/role`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role }),
      });
      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(data?.error ?? `HTTP ${response.status}`);
      }
      return ((await response.json()) as { user: UserRow }).user;
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: userKeys.list() }),
  });
}
