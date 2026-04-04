import { auth } from "@/auth";
import { NextResponse } from "next/server";

export default auth((req) => {
    const { pathname } = req.nextUrl;

    // Allow auth routes, login page, and static assets
    if (
        pathname.startsWith("/api/auth") ||
        pathname.startsWith("/login") ||
        pathname.startsWith("/_next") ||
        pathname.startsWith("/favicon") ||
        pathname === "/manifest.json" ||
        pathname === "/sw.js" ||
        pathname.startsWith("/icon-")
    ) {
        return NextResponse.next();
    }

    // Redirect unauthenticated users to login
    if (!req.auth) {
        const loginUrl = new URL("/login", req.url);
        return NextResponse.redirect(loginUrl);
    }

    return NextResponse.next();
});

export const config = {
    matcher: ["/((?!_next/static|_next/image).*)"],
};
