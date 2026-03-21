import { headers } from "next/headers";

import type { User } from "@supabase/supabase-js";

import { encryptValue, decryptValue } from "@/src/lib/crypto";
import { fetchAuthenticatedViewer } from "@/src/integrations/github/service";
import { createServiceRoleSupabaseClient, createServerSupabaseClient } from "@/src/services/_shared/supabase";
import type { Database } from "@/src/types/database";

type ConnectedAccountRow = Database["public"]["Tables"]["connected_accounts"]["Row"];

export async function getCurrentUser() {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return user;
}

export async function requireCurrentUser() {
  const user = await getCurrentUser();

  if (!user) {
    return null;
  }

  return user;
}

async function getRequestOrigin() {
  const headerList = await headers();
  const host = headerList.get("x-forwarded-host") ?? headerList.get("host");
  const proto = headerList.get("x-forwarded-proto") ?? "http";

  if (!host) {
    throw new Error("Unable to determine request origin.");
  }

  return `${proto}://${host}`;
}

export async function signInWithGitHub() {
  const supabase = await createServerSupabaseClient();
  const redirectTo = `${await getRequestOrigin()}/auth/callback`;
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "github",
    options: {
      redirectTo,
      scopes: "repo read:user user:email",
    },
  });

  if (error || !data.url) {
    throw new Error(error?.message ?? "Unable to start GitHub sign-in.");
  }

  return data.url;
}

export async function signOutCurrentUser() {
  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.auth.signOut();

  if (error) {
    throw new Error(error.message);
  }
}

export async function finalizeGitHubAuth(code: string) {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);

  if (error || !data.session || !data.user) {
    throw new Error(error?.message ?? "Unable to exchange GitHub OAuth code.");
  }

  await upsertProfile(data.user);
  await persistConnectedGitHubAccount({
    user: data.user,
    providerToken: data.session.provider_token,
    providerRefreshToken: data.session.provider_refresh_token,
    providerExpiresAt: data.session.expires_at,
  });

  return data.user;
}

async function upsertProfile(user: User) {
  const supabase = createServiceRoleSupabaseClient();
  const { error } = await supabase.from("profiles").upsert({
    id: user.id,
    email: user.email ?? null,
    full_name:
      typeof user.user_metadata.full_name === "string"
        ? user.user_metadata.full_name
        : typeof user.user_metadata.user_name === "string"
          ? user.user_metadata.user_name
          : null,
    avatar_url:
      typeof user.user_metadata.avatar_url === "string"
        ? user.user_metadata.avatar_url
        : null,
    updated_at: new Date().toISOString(),
  });

  if (error) {
    throw new Error(error.message);
  }
}

async function persistConnectedGitHubAccount(input: {
  user: User;
  providerToken: string | null | undefined;
  providerRefreshToken: string | null | undefined;
  providerExpiresAt: number | null | undefined;
}) {
  if (!input.providerToken) {
    throw new Error("GitHub provider token was not returned by Supabase.");
  }

  void input.providerRefreshToken;

  const viewer = await fetchAuthenticatedViewer(input.providerToken);
  const supabase = createServiceRoleSupabaseClient();
  const { error } = await supabase.from("connected_accounts").upsert(
    {
      user_id: input.user.id,
      provider: "github",
      provider_user_id: String(viewer.id),
      login: viewer.login,
      access_token_encrypted: encryptValue(input.providerToken),
      token_expires_at: input.providerExpiresAt
        ? new Date(input.providerExpiresAt * 1000).toISOString()
        : null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id,provider" },
  );

  if (error) {
    throw new Error(error.message);
  }
}

export async function getConnectedGitHubAccountForUser(userId: string) {
  const supabase = createServiceRoleSupabaseClient();
  const { data, error } = await supabase
    .from("connected_accounts")
    .select("*")
    .eq("user_id", userId)
    .eq("provider", "github")
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  if (!data) {
    return null;
  }

  const connectedAccount = data as ConnectedAccountRow;

  return {
    ...connectedAccount,
    accessToken: decryptValue(connectedAccount.access_token_encrypted),
  };
}
