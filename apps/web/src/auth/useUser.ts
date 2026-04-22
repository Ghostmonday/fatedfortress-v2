/**
 * apps/web/src/auth/useUser.ts — Reactive auth state for components.
 *
 * Provides a reactive user + profile pair that components can subscribe to.
 * Uses Supabase Realtime auth subscription internally.
 */

import { useState, useEffect } from "react";
import type { User } from "@supabase/supabase-js";
import { onAuthStateChange, getCurrentUser, getMyProfile } from "./index.js";
import type { Profile } from "./index.js";

export interface AuthState {
  user: User | null;
  profile: Profile | null;
  loading: boolean;
}

export function useUser(): AuthState {
  const [state, setState] = useState<AuthState>({
    user: null,
    profile: null,
    loading: true,
  });

  useEffect(() => {
    let mounted = true;

    async function init() {
      try {
        const [user, profile] = await Promise.all([getCurrentUser(), getMyProfile()]);
        if (mounted) {
          setState({ user, profile, loading: false });
        }
      } catch {
        if (mounted) {
          setState({ user: null, profile: null, loading: false });
        }
      }
    }

    init();

    // Subscribe to auth changes
    const { data: { subscription } } = onAuthStateChange(async (event, session) => {
      if (!mounted) return;
      if (event === "SIGNED_OUT") {
        setState({ user: null, profile: null, loading: false });
        return;
      }
      if (session?.user) {
        const profile = await getMyProfile();
        setState({ user: session.user, profile, loading: false });
      }
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  return state;
}
