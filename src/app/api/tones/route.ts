import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase";
import { rowToPreset, type ToneRow, type TonePatch } from "@/lib/tones-mapper";

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
    console.error("[api/tones] GET failed:", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    let body: TonePatch = {};
    try {
      body = (await req.json()) as TonePatch;
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
    console.error("[api/tones] POST failed:", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
