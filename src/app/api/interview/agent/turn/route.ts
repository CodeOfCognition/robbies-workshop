import { NextRequest, NextResponse } from "next/server";

// Proxies the interview agent turn to the AWS Python backend and forwards
// its SSE stream straight back to the client. We pipe `res.body` through
// without buffering so deltas reach the browser as they arrive.

const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:8000";
const WORKSHOP_BACKEND_API_KEY = process.env.WORKSHOP_BACKEND_API_KEY || "";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  if (!BACKEND_URL || !WORKSHOP_BACKEND_API_KEY) {
    return NextResponse.json(
      { error: "AI backend not configured" },
      { status: 503 }
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  let upstream: Response;
  try {
    upstream = await fetch(`${BACKEND_URL}/interview/turn`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": WORKSHOP_BACKEND_API_KEY,
        Accept: "text/event-stream",
      },
      body: JSON.stringify(body),
      // Don't let any intermediate buffer the stream.
      cache: "no-store",
    });
  } catch (err) {
    console.error("[api/interview/agent/turn] fetch failed:", err);
    return NextResponse.json(
      { error: "Failed to reach AI backend" },
      { status: 502 }
    );
  }

  if (!upstream.ok || !upstream.body) {
    const text = await upstream.text().catch(() => "");
    return NextResponse.json(
      { error: text || `Backend error: ${upstream.status}` },
      { status: upstream.status }
    );
  }

  return new Response(upstream.body, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-store",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
