import { cookies } from "next/headers";

import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";

import { getPublicEnv, getServerEnv } from "@/src/lib/env";
import type { Database } from "@/src/types/database";

type ServerSupabaseClient = ReturnType<typeof createServerClient<Database>>;
type ServiceRoleSupabaseClient = ReturnType<typeof createClient<Database>>;

export async function createServerSupabaseClient(): Promise<ServerSupabaseClient> {
  const cookieStore = await cookies();
  const publicEnv = getPublicEnv();

  return createServerClient<Database>(
    publicEnv.NEXT_PUBLIC_SUPABASE_URL,
    publicEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) => {
              cookieStore.set(name, value, options);
            });
          } catch {
            // Route handlers and server actions can write cookies, server components cannot.
          }
        },
      },
    },
  );
}

let serviceRoleClient: ServiceRoleSupabaseClient | null = null;

export function createServiceRoleSupabaseClient(): ServiceRoleSupabaseClient {
  if (!serviceRoleClient) {
    const env = getServerEnv();

    serviceRoleClient = createClient<Database>(
      env.NEXT_PUBLIC_SUPABASE_URL,
      env.SUPABASE_SERVICE_ROLE_KEY,
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
        },
      },
    );
  }

  return serviceRoleClient;
}
