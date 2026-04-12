import { NextRequest, NextResponse } from "next/server";
import {
  createServerSupabase,
  rowToPreset,
  ToneRow,
} from "@/lib/supabase";

export async function GET() {
  try {
    const supabase = createServerSupabase();
    const { data, error } = await supabase
      .from("tones")
      .select("*")
      .order("updated_at", { ascending: false });

    if (error) throw error;

    const presets = (data as ToneRow[]).map(rowToPreset);
    return NextResponse.json(presets);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[api/tones] GET failed:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

interface CreateBody {
  name?: string;
  amp_model?: string;
  effects?: {
    stompbox: string | null;
    modulation: string | null;
    delay: string | null;
    reverb: string | null;
  };
  song_name?: string | null;
  artist_name?: string | null;
  notes?: string | null;
}

export async function POST(req: NextRequest) {
  try {
    let body: CreateBody = {};
    try {
      body = (await req.json()) as CreateBody;
    } catch {
      // Empty body is allowed — we'll insert defaults.
      body = {};
    }

    const supabase = createServerSupabase();
    const insertRow = {
      name: body.name ?? "",
      amp_model: body.amp_model ?? "",
      effects: body.effects ?? {
        stompbox: null,
        modulation: null,
        delay: null,
        reverb: null,
      },
      song_name: body.song_name ?? null,
      artist_name: body.artist_name ?? null,
      notes: body.notes ?? null,
    };

    const { data, error } = await supabase
      .from("tones")
      .insert(insertRow)
      .select("*")
      .single();

    if (error) throw error;

    return NextResponse.json(rowToPreset(data as ToneRow));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[api/tones] POST failed:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
