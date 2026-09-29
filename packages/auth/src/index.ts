import { type Database, getDb } from "@et/db";
import * as schema from "@et/db/schema";
import {
	createConsoleSender,
	type EmailSender,
	passwordResetEmail,
} from "@et/email";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError } from "better-auth/api";

export type Auth = ReturnType<typeof createAuth>;
export type Session = Auth["$Infer"]["Session"];
export type User = Session["user"];

type AuthConfig = {
	/** Signs session cookies. A change invalidates every existing session. */
	secret: string;
	/** Public origin of the app, e.g. http://localhost:3100. No trailing slash. */
	baseUrl: string;
	google?: {
		clientId: string;
		clientSecret: string;
	};
	/**
	 * Where transactional mail goes. Defaults to printing it, so password reset
	 * works locally before a sending domain exists.
	 */
	email?: EmailSender;
	/**
	 * Whether this address may create an account. Sign-up is open when absent.
	 *
	 * Checked in a database hook rather than on the sign-up form, because the
	 * form is not the only way in: "Continue with Google" creates users too,
	 * and a check that only guards one door guards nothing.
	 */
	canSignUp?: (email: string) => Promise<boolean>;
};

/** How long a password-reset link stays valid. */
const RESET_TOKEN_TTL_SECONDS = 60 * 60;

/**
 * Build the Better Auth instance.
 *
 * Takes its config explicitly rather than reading the environment, so the
 * caller decides where secrets come from — which matters on Workers, where
 * there is no ambient process environment to rely on.
 */
export function createAuth(config: AuthConfig, db: Database = getDb()) {
	const email = config.email ?? createConsoleSender();

	return betterAuth({
		secret: config.secret,
		baseURL: config.baseUrl,
		database: drizzleAdapter(db, {
			provider: "pg",
			schema,
		}),
		emailAndPassword: {
			enabled: true,
			sendResetPassword: async ({ user, url }) => {
				await email.send(
					passwordResetEmail({
						to: user.email,
						url,
						expiresInMinutes: RESET_TOKEN_TTL_SECONDS / 60,
					}),
				);
			},
			resetPasswordTokenExpiresIn: RESET_TOKEN_TTL_SECONDS,
			// No email sender is wired up yet, so a verification mail could never
			// arrive and would lock every new account out. Turn this on in the same
			// change that adds the sender, not before.
			requireEmailVerification: false,
			minPasswordLength: 12,
		},
		socialProviders: config.google
			? {
					google: {
						clientId: config.google.clientId,
						clientSecret: config.google.clientSecret,
					},
				}
			: {},
		account: {
			accountLinking: {
				// Signing in with Google using an address that already has a password
				// account attaches to it rather than creating a second user. Safe here
				// because Google verifies its addresses.
				enabled: true,
				trustedProviders: ["google"],
			},
		},
		databaseHooks: config.canSignUp
			? {
					user: {
						create: {
							before: async (newUser) => {
								const allowed = await config.canSignUp?.(
									newUser.email.toLowerCase(),
								);
								if (!allowed) {
									throw new APIError("FORBIDDEN", {
										message:
											"Accounts are by invitation. Open the invite link you were sent, and sign up with the address it was sent to.",
									});
								}
							},
						},
					},
				}
			: undefined,
		session: {
			expiresIn: 60 * 60 * 24 * 30,
			// Slide the expiry at most once a day so an active user stays signed in
			// without writing a session row on every request.
			updateAge: 60 * 60 * 24,
		},
		advanced: {
			// Workers terminate TLS, so cookies must be marked secure in production
			// even though the app itself sees a plain request.
			useSecureCookies: config.baseUrl.startsWith("https://"),
		},
	});
}

/**
 * Reads the config out of an environment-shaped record and builds the instance.
 *
 * Throws with the variable's name when something required is missing, so a
 * misconfigured deploy fails with a readable message instead of a redirect loop.
 */
export function createAuthFromEnv(
	env: Record<string, string | undefined>,
	options: {
		db?: Database;
		email?: EmailSender;
		canSignUp?: (email: string) => Promise<boolean>;
	} = {},
): Auth {
	const secret = required(env, "BETTER_AUTH_SECRET");
	const baseUrl = required(env, "BETTER_AUTH_URL").replace(/\/+$/, "");

	const clientId = env.GOOGLE_CLIENT_ID;
	const clientSecret = env.GOOGLE_CLIENT_SECRET;

	return createAuth(
		{
			secret,
			baseUrl,
			// Google stays off until both halves are present; one alone is a
			// half-configured provider that fails at the redirect instead of here.
			...(clientId && clientSecret
				? { google: { clientId, clientSecret } }
				: {}),
			...(options.email ? { email: options.email } : {}),
			...(options.canSignUp ? { canSignUp: options.canSignUp } : {}),
		},
		options.db,
	);
}

function required(
	env: Record<string, string | undefined>,
	name: string,
): string {
	const value = env[name];
	if (!value) {
		throw new Error(
			`${name} is not set — see apps/web/.dev.vars.example. Generate a secret with: openssl rand -base64 32`,
		);
	}
	return value;
}
