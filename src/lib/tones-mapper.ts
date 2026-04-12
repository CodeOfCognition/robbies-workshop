import type { Preset } from "./data";

// Shared mappers between the client store and the /api/tones route
// handlers. Kept in its own file (no Supabase imports) so it can be
// safely pulled into client components as well as server routes.

export interface ToneRow {
  id: string;
  name: string;
  amp_model: string;
  effects: {
    stompbox: string | null;
    modulation: string | null;
    delay: string | null;
    reverb: string | null;
  };
  song_name: string | null;
  artist_name: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

// Wire shape for POST/PATCH request bodies to /api/tones. Snake_case
// to match the DB row. All fields optional — the single source of
// truth shared by both route handlers and the client store.
export interface TonePatch {
  name?: string;
  amp_model?: string;
  effects?: ToneRow["effects"];
  song_name?: string | null;
  artist_name?: string | null;
  notes?: string | null;
}

export function rowToPreset(row: ToneRow): Preset {
  const preset: Preset = {
    id: row.id,
    name: row.name,
    ampModel: row.amp_model,
    effects: {
      stompbox: row.effects?.stompbox ?? null,
      modulation: row.effects?.modulation ?? null,
      delay: row.effects?.delay ?? null,
      reverb: row.effects?.reverb ?? null,
    },
    createdAt: new Date(row.created_at).getTime(),
    updatedAt: new Date(row.updated_at).getTime(),
  };
  if (row.song_name != null) preset.songName = row.song_name;
  if (row.artist_name != null) preset.artistName = row.artist_name;
  if (row.notes != null) preset.notes = row.notes;
  return preset;
}

export function presetPatchToRow(patch: Partial<Preset>): TonePatch {
  const row: TonePatch = {};
  if (patch.name !== undefined) row.name = patch.name;
  if (patch.ampModel !== undefined) row.amp_model = patch.ampModel;
  if (patch.effects !== undefined) row.effects = patch.effects;
  // Optional text fields: coerce empty string to null so the round-trip
  // through the DB never produces a "" value for fields the type says
  // are optional.
  if (patch.songName !== undefined)
    row.song_name = patch.songName === "" ? null : patch.songName;
  if (patch.artistName !== undefined)
    row.artist_name = patch.artistName === "" ? null : patch.artistName;
  if (patch.notes !== undefined)
    row.notes = patch.notes === "" ? null : patch.notes;
  return row;
}
