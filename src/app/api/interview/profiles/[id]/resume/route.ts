import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase";
import {
  rowToProfile,
  type ProfileRow,
  type ResumeFile,
} from "@/lib/interview-mapper";

const BUCKET = "interview-resumes";
const MAX_BYTES = 10 * 1024 * 1024; // 10 MB

async function ensureBucket(
  supabase: ReturnType<typeof createServerSupabase>
) {
  // Lazily create the bucket on first use; ignore "already exists" errors.
  const { error } = await supabase.storage.createBucket(BUCKET, {
    public: false,
    fileSizeLimit: MAX_BYTES,
  });
  if (error && !/already exists|duplicate/i.test(error.message)) {
    throw error;
  }
}

// Upload a new résumé file. Multipart form data with field `file`.
// Replaces any existing résumé on the profile.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json(
        { error: "Expected multipart field 'file'" },
        { status: 400 }
      );
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json(
        { error: `File too large (max ${MAX_BYTES / 1024 / 1024} MB)` },
        { status: 413 }
      );
    }
    const ext = (file.name.split(".").pop() || "").toLowerCase();

    const supabase = createServerSupabase();
    await ensureBucket(supabase);

    // Read existing profile so we can clean up any prior file.
    const { data: existing } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (!existing) {
      return NextResponse.json({ error: "Profile not found" }, { status: 404 });
    }
    const prevPath = (existing as ProfileRow).resume?.storagePath;

    // Upload to a per-profile path with a random suffix.
    const random = Math.random().toString(36).slice(2, 10);
    const storagePath = `${id}/${Date.now().toString(36)}-${random}${
      ext ? "." + ext : ""
    }`;
    const arrayBuffer = await file.arrayBuffer();
    const { error: uploadErr } = await supabase.storage
      .from(BUCKET)
      .upload(storagePath, arrayBuffer, {
        contentType: file.type || "application/octet-stream",
        upsert: false,
      });
    if (uploadErr) throw uploadErr;

    const resume: ResumeFile = {
      name: file.name,
      size: file.size,
      ext,
      storagePath,
    };

    // Patch profile row.
    const { data: updated, error: patchErr } = await supabase
      .from("profiles")
      .update({ resume, updated_at: new Date().toISOString() })
      .eq("id", id)
      .select("*")
      .maybeSingle();
    if (patchErr) throw patchErr;

    // Best-effort cleanup of the prior file.
    if (prevPath) {
      await supabase.storage.from(BUCKET).remove([prevPath]).catch(() => {});
    }

    return NextResponse.json(rowToProfile(updated as ProfileRow));
  } catch (err) {
    console.error("[api/interview/profiles/resume] POST failed:", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

// Remove the résumé file from storage and clear the JSONB on the profile.
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supabase = createServerSupabase();
    const { data: existing } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (!existing) {
      return NextResponse.json({ error: "Profile not found" }, { status: 404 });
    }
    const path = (existing as ProfileRow).resume?.storagePath;
    if (path) {
      await supabase.storage.from(BUCKET).remove([path]).catch(() => {});
    }
    const { data: updated, error } = await supabase
      .from("profiles")
      .update({ resume: null, updated_at: new Date().toISOString() })
      .eq("id", id)
      .select("*")
      .maybeSingle();
    if (error) throw error;
    return NextResponse.json(rowToProfile(updated as ProfileRow));
  } catch (err) {
    console.error("[api/interview/profiles/resume] DELETE failed:", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

// Generate a short-lived signed URL so the browser can download/preview
// the résumé directly from Supabase Storage.
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supabase = createServerSupabase();
    const { data: existing } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (!existing) {
      return NextResponse.json({ error: "Profile not found" }, { status: 404 });
    }
    const path = (existing as ProfileRow).resume?.storagePath;
    if (!path) {
      return NextResponse.json({ error: "No résumé on file" }, { status: 404 });
    }
    const { data, error } = await supabase.storage
      .from(BUCKET)
      .createSignedUrl(path, 60); // 60s
    if (error || !data) throw error || new Error("No signed URL");
    return NextResponse.json({ url: data.signedUrl });
  } catch (err) {
    console.error("[api/interview/profiles/resume] GET failed:", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
