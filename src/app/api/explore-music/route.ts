import { NextRequest, NextResponse } from "next/server";

const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:8000";
const WORKSHOP_BACKEND_API_KEY = process.env.WORKSHOP_BACKEND_API_KEY || "";

export async function POST(req: NextRequest) {
    if (!BACKEND_URL || !WORKSHOP_BACKEND_API_KEY) {
        return NextResponse.json(
            { error: "AI backend not configured" },
            { status: 503 }
        );
    }

    try {
        const body = await req.json();

        const response = await fetch(`${BACKEND_URL}/explore-music`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "X-API-Key": WORKSHOP_BACKEND_API_KEY,
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
        console.error("Explore music error:", error);
        return NextResponse.json(
            { error: "Failed to reach AI backend" },
            { status: 502 }
        );
    }
}
