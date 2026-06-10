import { NextResponse } from "next/server";
import { getCurrentYearTopArtists } from "@/lib/live-music/top-artists";

export async function GET() {
  try {
    const artists = await getCurrentYearTopArtists(100);
    return NextResponse.json({
      year: new Date().getFullYear(),
      artists,
    });
  } catch (err) {
    console.error("[api/live-music/top-artists] failed:", err);
    return NextResponse.json(
      { error: "Failed to load top artists" },
      { status: 500 }
    );
  }
}
