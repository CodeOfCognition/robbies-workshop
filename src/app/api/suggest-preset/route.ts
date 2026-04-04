import { NextRequest, NextResponse } from "next/server";

const CLOUD_RUN_URL = process.env.CLOUD_RUN_URL || "http://localhost:8000";
const CLOUD_RUN_API_KEY = process.env.CLOUD_RUN_API_KEY || "";

export async function POST(req: NextRequest) {
    if (!CLOUD_RUN_URL || !CLOUD_RUN_API_KEY) {
        return NextResponse.json(
            { error: "AI backend not configured" },
            { status: 503 }
        );
    }

    try {
        const body = await req.json();

        const response = await fetch(`${CLOUD_RUN_URL}/suggest-preset`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "X-API-Key": CLOUD_RUN_API_KEY,
            },
            body: JSON.stringify(body),
        });

        if (!response.ok) {
            const errorText = await response.text();
            return NextResponse.json(
                { error: `AI backend error: ${errorText}` },
                { status: response.status }
            );
        }

        const data = await response.json();
        return NextResponse.json(data);
    } catch (error) {
        console.error("Suggest preset error:", error);
        return NextResponse.json(
            { error: "Failed to reach AI backend" },
            { status: 502 }
        );
    }
}
