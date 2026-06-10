import { createServerSupabase } from "@/lib/supabase";
import type { TopArtist } from "./types";

const PAGE_SIZE = 1000;
const MAX_ROWS = 50000;

export async function getCurrentYearTopArtists(limit = 100): Promise<TopArtist[]> {
  const supabase = createServerSupabase();
  const year = new Date().getFullYear();
  const start = `${year}-01-01T00:00:00.000Z`;
  const totals = new Map<string, number>();

  for (let from = 0; from < MAX_ROWS; from += PAGE_SIZE) {
    const to = from + PAGE_SIZE - 1;
    const { data, error } = await supabase
      .from("streaming_history")
      .select("artist_name, ms_played")
      .gte("ts", start)
      .not("artist_name", "is", null)
      .range(from, to);

    if (error) throw error;
    if (!data || data.length === 0) break;

    for (const row of data) {
      const name = String(row.artist_name || "").trim();
      if (!name) continue;
      totals.set(name, (totals.get(name) || 0) + Number(row.ms_played || 0));
    }

    if (data.length < PAGE_SIZE) break;
  }

  return Array.from(totals.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([name, msPlayed], index) => ({ name, msPlayed, rank: index + 1 }));
}
