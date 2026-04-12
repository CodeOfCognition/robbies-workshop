import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase";
import { rowToPreset, type ToneRow, type TonePatch } from "@/lib/tones-mapper";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supabase = createServerSupabase();
    const { data, error } = await supabase
      .from("tones")
      .select("*")
      .eq("id", id)
      .maybeSingle();

    if (error) throw error;
    if (!data) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json(rowToPreset(data as ToneRow));
  } catch (err) {
    console.error("[api/tones] GET by id failed:", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = (await req.json()) as TonePatch;

    const updateRow: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };
    if (body.name !== undefined) updateRow.name = body.name;
    if (body.amp_model !== undefined) updateRow.amp_model = body.amp_model;
    if (body.effects !== undefined) updateRow.effects = body.effects;
    if (body.song_name !== undefined) updateRow.song_name = body.song_name;
    if (body.artist_name !== undefined)
      updateRow.artist_name = body.artist_name;
    if (body.notes !== undefined) updateRow.notes = body.notes;

    const supabase = createServerSupabase();
    const { data, error } = await supabase
      .from("tones")
      .update(updateRow)
      .eq("id", id)
      .select("*")
      .maybeSingle();

    if (error) throw error;
    if (!data) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json(rowToPreset(data as ToneRow));
  } catch (err) {
    console.error("[api/tones] PATCH failed:", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supabase = createServerSupabase();
    const { error } = await supabase.from("tones").delete().eq("id", id);
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[api/tones] DELETE failed:", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
