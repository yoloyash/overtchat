"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { userKeys } from "@/lib/queries/keys";

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
