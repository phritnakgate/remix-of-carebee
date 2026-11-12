import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

export type Profile = Database["public"]["Tables"]["profiles"]["Row"];

interface ActiveBoxValue {
  userId: string;
  ownerId: string;
  setOwnerId: (id: string) => void;
  isOwn: boolean;
  me: Profile | null;
  elders: Profile[];
  caregivers: Profile[];
  ownerProfile: Profile | null;
}

const Ctx = createContext<ActiveBoxValue | null>(null);
const KEY = "smrb-active-owner";

export function useLinks(userId: string) {
  return useQuery({
    queryKey: ["links", userId],
    queryFn: async () => {
      const { data: links, error } = await supabase.from("caregiver_links").select("*");
      if (error) throw error;
      const ids = Array.from(new Set([userId, ...links.flatMap((l) => [l.elder_id, l.caregiver_id])]));
      const { data: profiles, error: pErr } = await supabase.from("profiles").select("*").in("id", ids);
      if (pErr) throw pErr;
      const byId = new Map(profiles.map((p) => [p.id, p]));
      return {
        links,
        me: byId.get(userId) ?? null,
        elders: links.filter((l) => l.caregiver_id === userId).map((l) => byId.get(l.elder_id)).filter(Boolean) as Profile[],
        caregivers: links.filter((l) => l.elder_id === userId).map((l) => byId.get(l.caregiver_id)).filter(Boolean) as Profile[],
      };
    },
  });
}

export function ActiveBoxProvider({ userId, children }: { userId: string; children: ReactNode }) {
  const { data } = useLinks(userId);
  const [ownerId, setOwnerIdState] = useState(userId);

  useEffect(() => {
    const stored = window.localStorage.getItem(KEY);
    if (stored) setOwnerIdState(stored);
  }, []);

  const elders = data?.elders ?? [];
  // Fall back to own box if the stored person is no longer linked.
  const validOwner = ownerId === userId || elders.some((e) => e.id === ownerId) ? ownerId : userId;

  const value = useMemo<ActiveBoxValue>(
    () => ({
      userId,
      ownerId: data ? validOwner : userId,
      setOwnerId: (id) => {
        setOwnerIdState(id);
        window.localStorage.setItem(KEY, id);
      },
      isOwn: (data ? validOwner : userId) === userId,
      me: data?.me ?? null,
      elders,
      caregivers: data?.caregivers ?? [],
      ownerProfile:
        (data ? validOwner : userId) === userId ? (data?.me ?? null) : (elders.find((e) => e.id === validOwner) ?? null),
    }),
    [userId, validOwner, data, elders],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useActiveBox() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useActiveBox must be used inside ActiveBoxProvider");
  return v;
}
