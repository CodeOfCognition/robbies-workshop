import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase";
import {
  rowToInterview,
  type InterviewRow,
  type InterviewPatch,
} from "@/lib/interview-mapper";

export async function GET(req: NextRequest) {
  try {
    const profileId = req.nextUrl.searchParams.get("profile_id");
    const supabase = createServerSupabase();
    let query = supabase
      .from("interviews")
      .select("*")
      .order("created_at", { ascending: false });
    if (profileId) {
      query = query.eq("profile_id", profileId);
    }
    const { data, error } = await query;
    if (error) throw error;
    const interviews = (data as InterviewRow[]).map(rowToInterview);
    return NextResponse.json(interviews);
  } catch (err) {
    console.error("[api/interview/interviews] GET failed:", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as InterviewPatch;
    if (!body.profile_id || !body.job_id || !body.type) {
      return NextResponse.json(
        { error: "profile_id, job_id, and type are required" },
        { status: 400 }
      );
    }

    const supabase = createServerSupabase();
    const insertRow = {
      profile_id: body.profile_id,
      job_id: body.job_id,
      type: body.type,
      title: body.title ?? "",
      notes: body.notes ?? "",
      status: body.status ?? "done",
      duration_ms: body.duration_ms ?? 0,
      questions: body.questions ?? 0,
      transcript: body.transcript ?? [],
      feedback: body.feedback ?? null,
      proposed_memories: body.proposed_memories ?? null,
    };

    const { data, error } = await supabase
      .from("interviews")
      .insert(insertRow)
      .select("*")
      .single();

    if (error) throw error;
    return NextResponse.json(rowToInterview(data as InterviewRow));
  } catch (err) {
    console.error("[api/interview/interviews] POST failed:", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
