import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase";
import {
  rowToJob,
  type JobRow,
  type JobPatch,
} from "@/lib/interview-mapper";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supabase = createServerSupabase();
    const { data, error } = await supabase
      .from("jobs")
      .select("*")
      .eq("id", id)
      .maybeSingle();

    if (error) throw error;
    if (!data) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json(rowToJob(data as JobRow));
  } catch (err) {
    console.error("[api/interview/jobs] GET by id failed:", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = (await req.json()) as JobPatch;

    const updateRow: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };
    if (body.company !== undefined) updateRow.company = body.company;
    if (body.role !== undefined) updateRow.role = body.role;
    if (body.url !== undefined) updateRow.url = body.url;
    if (body.posting !== undefined) updateRow.posting = body.posting;
    if (body.research !== undefined) updateRow.research = body.research;

    const supabase = createServerSupabase();
    const { data, error } = await supabase
      .from("jobs")
      .update(updateRow)
      .eq("id", id)
      .select("*")
      .maybeSingle();

    if (error) throw error;
    if (!data) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json(rowToJob(data as JobRow));
  } catch (err) {
    console.error("[api/interview/jobs] PATCH failed:", err);
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
    const { error } = await supabase.from("jobs").delete().eq("id", id);
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[api/interview/jobs] DELETE failed:", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
