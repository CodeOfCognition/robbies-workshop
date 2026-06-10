# Re-enable OAuth

Auth is temporarily disabled so the app can be accessed without signing in.

To turn GitHub OAuth back on:

1. Restore `src/middleware.ts` so it imports `auth` from `@/auth`, wraps the middleware with `auth(...)`, allows auth/static paths, and redirects unauthenticated requests to `/login`.
2. Restore the sign-out button in `src/app/page.tsx` by importing `LogOut` from `lucide-react`, importing `signOut` from `next-auth/react`, and rendering the header button that calls `signOut()`.
3. Keep `src/auth.ts`, `src/app/login/page.tsx`, and `src/app/api/auth/[...nextauth]/route.ts` as-is unless the OAuth provider itself changes.
4. Run `npm run build`, test a logged-out browser session, then push to `main`.

The quickest rollback is to revert the commit that disabled auth.
