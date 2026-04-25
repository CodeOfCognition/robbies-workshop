import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase";
import {
  rowToProfile,
  type ProfileRow,
  type ProfilePatch,
} from "@/lib/interview-mapper";

export async function GET() {
  try {
    const supabase = createServerSupabase();
    const { data, error } = await supabase
      .from("profiles")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) throw error;
    const profiles = (data as ProfileRow[]).map(rowToProfile);
    return NextResponse.json(profiles);
  } catch (err) {
    console.error("[api/interview/profiles] GET failed:", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    let body: ProfilePatch = {};
    try {
      body = (await req.json()) as ProfilePatch;
    } catch {
      body = {};
    }

    const supabase = createServerSupabase();
    const insertRow = {
      name: body.name ?? "",
      resume: body.resume ?? null,
      memories: body.memories ?? [],
    };

    const { data, error } = await supabase
      .from("profiles")
      .insert(insertRow)
      .select("*")
      .single();

    if (error) throw error;
    return NextResponse.json(rowToProfile(data as ProfileRow));
  } catch (err) {
    console.error("[api/interview/profiles] POST failed:", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
