import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase";
import { rowToPreset, type ToneRow } from "@/lib/tones-mapper";

const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:8000";
const WORKSHOP_BACKEND_API_KEY = process.env.WORKSHOP_BACKEND_API_KEY || "";

// Content-block shape stored in tone_messages.content (JSONB). We keep the
// agent-native array of blocks as-is — no camelCase mapping inside the
// blocks — since the frontend renders them directly.
type ContentBlock = {
  type: string;
  text?: string;
  name?: string;
  input?: unknown;
};

interface ToneMessageRow {
  role: "user" | "assistant";
  content: ContentBlock[];
  created_at: string;
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supabase = createServerSupabase();
    const { data, error } = await supabase
      .from("tone_messages")
      .select("role, content, created_at")
      .eq("tone_id", id)
      .order("created_at", { ascending: true });

    if (error) throw error;

    const messages = ((data ?? []) as ToneMessageRow[]).map((row) => ({
      role: row.role,
      content: row.content,
      createdAt: row.created_at,
    }));

    return NextResponse.json({ messages });
  } catch (err) {
    console.error("[api/tones/chat] GET failed:", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    if (!BACKEND_URL || !WORKSHOP_BACKEND_API_KEY) {
      return NextResponse.json(
        { error: "AI backend not configured" },
        { status: 503 }
      );
    }

    const { id } = await params;
    const body = (await req.json()) as { message?: string };
    const userMessage = body.message?.trim();
    if (!userMessage) {
      return NextResponse.json(
        { error: "Message is required" },
        { status: 400 }
      );
    }

    const response = await fetch(`${BACKEND_URL}/tone-chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": WORKSHOP_BACKEND_API_KEY,
      },
      body: JSON.stringify({ tone_id: id, user_message: userMessage }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(
        "[api/tones/chat] backend error:",
        response.status,
        errorText
      );
      return NextResponse.json(
        { error: "AI backend error" },
        { status: 502 }
      );
    }

    const data = (await response.json()) as {
      messages: Array<{ role: "user" | "assistant"; content: ContentBlock[] }>;
      tone: ToneRow;
    };

    const preset = rowToPreset(data.tone);
    return NextResponse.json({ messages: data.messages, tone: preset });
  } catch (err) {
    console.error("[api/tones/chat] POST failed:", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
