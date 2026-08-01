import {
  createAdminClient,
  createContextClient,
  verifyAuth,
} from "@supabase/server/core";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { SupabaseEnv } from "@supabase/server";

/** Map Next.js env names onto Partial<SupabaseEnv>. */
export function resolveNextSupabaseEnv(): Partial<SupabaseEnv> {
  const url =
    process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? undefined;

  const publishableKey =
    process.env.SUPABASE_PUBLISHABLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
    undefined;

  const secretKey = process.env.SUPABASE_SECRET_KEY ?? undefined;

  return {
    url,
    publishableKeys: publishableKey ? { default: publishableKey } : {},
    secretKeys: secretKey ? { default: secretKey } : {},
  };
}

/** RLS-scoped client (publishable / anon role). */
export function createPublishableClient(): SupabaseClient {
  return createContextClient({ env: resolveNextSupabaseEnv() });
}

/** Secret-key client that bypasses RLS. */
export function createSecretClient(): SupabaseClient {
  return createAdminClient({ env: resolveNextSupabaseEnv() });
}

/** @deprecated Prefer createPublishableClient */
export const createSupabaseServerClient = createPublishableClient;
/** @deprecated Prefer createSecretClient */
export const createSupabaseServiceClient = createSecretClient;

export type RetrainAuth =
  | { ok: true; authMode: string }
  | { ok: false; status: number; message: string };

/**
 * Retrain credential gate.
 * Preferred: apikey secret. Fallback: Bearer CRON_SECRET.
 */
export async function authorizeRetrain(request: Request): Promise<RetrainAuth> {
  const env = resolveNextSupabaseEnv();
  const { data: auth, error: authError } = await verifyAuth(request, {
    auth: "secret",
    env,
  });

  if (!authError && auth) {
    return { ok: true, authMode: auth.authMode };
  }

  const cronOk =
    !!process.env.CRON_SECRET &&
    request.headers.get("authorization") ===
      `Bearer ${process.env.CRON_SECRET}`;

  if (cronOk) {
    return { ok: true, authMode: "cron_secret" };
  }

  const status =
    authError && "status" in authError && typeof authError.status === "number"
      ? authError.status
      : 401;

  return {
    ok: false,
    status,
    message: authError?.message || "Unauthorized",
  };
}

/**
 * Single write path for team_stats freshness (RPC).
 * Scraper uses SQL REFRESH; both target the same MV.
 */
export async function refreshTeamStats(
  client: SupabaseClient = createSecretClient(),
): Promise<{ ok: true } | { ok: false; message: string }> {
  const { error } = await client.rpc("refresh_team_stats");
  if (error) {
    return { ok: false, message: error.message };
  }
  return { ok: true };
}
