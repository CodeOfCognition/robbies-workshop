import type { Preset } from "./data";
import { presetPatchToRow } from "./tones-mapper";

// Client-side store for ToneBoard presets. All calls go through the
// /api/tones/* routes, which are gated by the global NextAuth middleware
// and backed by Supabase.

async function parseOrThrow<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let msg = `Request failed: ${res.status}`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body?.error) msg = body.error;
    } catch {
      // ignore
    }
    throw new Error(msg);
  }
  return (await res.json()) as T;
}

export async function listPresets(): Promise<Preset[]> {
  const res = await fetch("/api/tones", { cache: "no-store" });
  return parseOrThrow<Preset[]>(res);
}

export async function getPreset(id: string): Promise<Preset> {
  const res = await fetch(`/api/tones/${encodeURIComponent(id)}`, {
    cache: "no-store",
  });
  return parseOrThrow<Preset>(res);
}

export async function createPreset(
  initial: Partial<Preset> = {}
): Promise<Preset> {
  const body = presetPatchToRow(initial);
  const res = await fetch("/api/tones", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return parseOrThrow<Preset>(res);
}

export async function updatePreset(
  id: string,
  patch: Partial<Preset>
): Promise<Preset> {
  const body = presetPatchToRow(patch);
  const res = await fetch(`/api/tones/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return parseOrThrow<Preset>(res);
}

export async function deletePreset(id: string): Promise<void> {
  const res = await fetch(`/api/tones/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
  await parseOrThrow<{ ok: true }>(res);
}
