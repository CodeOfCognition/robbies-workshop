import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase";
import {
  rowToInterview,
  type InterviewRow,
  type InterviewPatch,
} from "@/lib/interview-mapper";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supabase = createServerSupabase();
    const { data, error } = await supabase
      .from("interviews")
      .select("*")
      .eq("id", id)
      .maybeSingle();

    if (error) throw error;
    if (!data) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json(rowToInterview(data as InterviewRow));
  } catch (err) {
    console.error("[api/interview/interviews] GET by id failed:", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = (await req.json()) as InterviewPatch;

    const updateRow: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };
    if (body.type !== undefined) updateRow.type = body.type;
    if (body.title !== undefined) updateRow.title = body.title;
    if (body.notes !== undefined) updateRow.notes = body.notes;
    if (body.status !== undefined) updateRow.status = body.status;
    if (body.duration_ms !== undefined) updateRow.duration_ms = body.duration_ms;
    if (body.questions !== undefined) updateRow.questions = body.questions;
    if (body.transcript !== undefined) updateRow.transcript = body.transcript;
    if (body.feedback !== undefined) updateRow.feedback = body.feedback;
    if (body.proposed_memories !== undefined)
      updateRow.proposed_memories = body.proposed_memories;

    const supabase = createServerSupabase();
    const { data, error } = await supabase
      .from("interviews")
      .update(updateRow)
      .eq("id", id)
      .select("*")
      .maybeSingle();

    if (error) throw error;
    if (!data) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json(rowToInterview(data as InterviewRow));
  } catch (err) {
    console.error("[api/interview/interviews] PATCH failed:", err);
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
    const { error } = await supabase
      .from("interviews")
      .delete()
      .eq("id", id);
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[api/interview/interviews] DELETE failed:", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
