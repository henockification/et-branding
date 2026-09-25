/**
 * Shared, framework-free domain types and schemas.
 *
 * Both the web app and the agents import from here so a change to the domain
 * shows up as a type error on both sides at once. Zod schemas (not bare types)
 * are the convention: agents need runtime validation of model output, and the
 * web app needs it for form and request payloads.
 */

export type { Branding } from "./branding.ts";
export { BRANDING, LOGO, LOGO_RULES } from "./branding.ts";
