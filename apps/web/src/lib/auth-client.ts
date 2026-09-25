import { createAuthClient } from "better-auth/react";

/**
 * Browser-side auth. Same origin as the app, so no baseURL is needed — the
 * client talks to the splat route at /api/auth/*.
 */
export const authClient = createAuthClient();

export const { signIn, signUp, signOut, useSession } = authClient;
