import { NextResponse } from "next/server";

export async function POST(req: Request) {
  const payload = await req.json().catch(() => ({ parseError: true }));
  console.error("[transcribe-error]", JSON.stringify(payload));
  return new NextResponse(null, { status: 204 });
}
