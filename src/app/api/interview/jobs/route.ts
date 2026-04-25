import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase";
import {
  rowToJob,
  type JobRow,
  type JobPatch,
} from "@/lib/interview-mapper";

export async function GET(req: NextRequest) {
  try {
    const profileId = req.nextUrl.searchParams.get("profile_id");
    const supabase = createServerSupabase();
    let query = supabase
      .from("jobs")
      .select("*")
      .order("created_at", { ascending: false });
    if (profileId) {
      query = query.eq("profile_id", profileId);
    }
    const { data, error } = await query;
    if (error) throw error;
    const jobs = (data as JobRow[]).map(rowToJob);
    return NextResponse.json(jobs);
  } catch (err) {
    console.error("[api/interview/jobs] GET failed:", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as JobPatch;
    if (!body.profile_id) {
      return NextResponse.json(
        { error: "profile_id is required" },
        { status: 400 }
      );
    }

    const supabase = createServerSupabase();
    const insertRow = {
      profile_id: body.profile_id,
      company: body.company ?? "",
      role: body.role ?? "",
      url: body.url ?? "",
      posting: body.posting ?? "",
      research: body.research ?? "",
    };

    const { data, error } = await supabase
      .from("jobs")
      .insert(insertRow)
      .select("*")
      .single();

    if (error) throw error;
    return NextResponse.json(rowToJob(data as JobRow));
  } catch (err) {
    console.error("[api/interview/jobs] POST failed:", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
