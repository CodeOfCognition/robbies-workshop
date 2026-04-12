import { createClient, SupabaseClient } from "@supabase/supabase-js";

// Server-only Supabase client for /api/tones/* routes.
// This file reads SUPABASE_SERVICE_ROLE_KEY from env — it must NEVER be
// imported from a client component. It is only referenced by API route
// handlers, which Next.js runs on the server.

let cached: SupabaseClient | null = null;

export function createServerSupabase(): SupabaseClient {
  if (cached) return cached;

  const url = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url) {
    throw new Error("SUPABASE_URL is not set");
  }
  if (!serviceRoleKey) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY is not set");
  }

  cached = createClient(url, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });

  return cached;
}

// Re-export mappers for convenience in route handlers.
export {
  rowToPreset,
  presetPatchToRow,
  type ToneRow,
} from "./tones-mapper";
