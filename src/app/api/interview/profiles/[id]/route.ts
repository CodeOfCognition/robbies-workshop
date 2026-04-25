import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase";
import {
  rowToProfile,
  type ProfileRow,
  type ProfilePatch,
} from "@/lib/interview-mapper";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supabase = createServerSupabase();
    const { data, error } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", id)
      .maybeSingle();

    if (error) throw error;
    if (!data) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json(rowToProfile(data as ProfileRow));
  } catch (err) {
    console.error("[api/interview/profiles] GET by id failed:", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = (await req.json()) as ProfilePatch;

    const updateRow: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };
    if (body.name !== undefined) updateRow.name = body.name;
    if (body.resume !== undefined) updateRow.resume = body.resume;
    if (body.memories !== undefined) updateRow.memories = body.memories;

    const supabase = createServerSupabase();
    const { data, error } = await supabase
      .from("profiles")
      .update(updateRow)
      .eq("id", id)
      .select("*")
      .maybeSingle();

    if (error) throw error;
    if (!data) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json(rowToProfile(data as ProfileRow));
  } catch (err) {
    console.error("[api/interview/profiles] PATCH failed:", err);
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
    const { error } = await supabase.from("profiles").delete().eq("id", id);
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[api/interview/profiles] DELETE failed:", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
