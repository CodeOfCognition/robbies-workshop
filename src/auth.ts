import NextAuth from "next-auth";
import GitHub from "next-auth/providers/github";

const allowedUsers = (process.env.ALLOWED_GITHUB_ID || "CodeOfCognition")
    .split(",")
    .map((u) => u.trim().toLowerCase());

export const { handlers, auth, signIn, signOut } = NextAuth({
    providers: [GitHub],
    pages: {
        signIn: "/login",
    },
    callbacks: {
        async signIn({ profile }) {
            // Only allow specific GitHub usernames
            const username = (profile?.login as string)?.toLowerCase();
            return allowedUsers.includes(username);
        },
        async session({ session, token }) {
            // Pass GitHub username into the session
            if (token?.username) {
                (session.user as unknown as { username: unknown }).username = token.username;
            }
            return session;
        },
        async jwt({ token, profile }) {
            if (profile?.login) {
                token.username = profile.login;
            }
            return token;
        },
    },
});
