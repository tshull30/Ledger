// Browser login for the /submit form.
//
// Why: Grok Bot fills in the form from your Chrome, but (sensibly) refuses to type secret keys.
// So you log in once yourself; Chrome keeps a signed cookie; after that the form doesn't
// ask for the key, and Grok Bot can submit on its own in that browser.
//
// The cookie is stateless: "<issuedAtMs>.<hmac>" signed with the ingest key.
// Changing INGEST_KEY logs everyone out.
import { createHmac, timingSafeEqual } from "node:crypto";

export const COOKIE_NAME = "oa_session";
export const SESSION_DAYS = 30;

const sign = (secret: string, issuedAt: string) =>
  createHmac("sha256", secret).update(`oracle-agent-session:${issuedAt}`).digest("hex");

export function makeSession(secret: string, now = Date.now()) {
  const issuedAt = String(now);
  return `${issuedAt}.${sign(secret, issuedAt)}`;
}

export function isValidSession(secret: string, value: string | undefined, now = Date.now()) {
  if (!value) return false;
  const [issuedAt, mac] = value.split(".");
  if (!issuedAt || !mac || !/^\d+$/.test(issuedAt)) return false;
  const age = now - Number(issuedAt);
  if (age < 0 || age > SESSION_DAYS * 86_400_000) return false;
  const expected = Buffer.from(sign(secret, issuedAt));
  const given = Buffer.from(mac);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

export function readCookie(header: string | undefined, name: string) {
  for (const part of (header ?? "").split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return undefined;
}

export function sessionCookie(value: string, secure: boolean) {
  return [
    `${COOKIE_NAME}=${encodeURIComponent(value)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax", // not sent on cross-site POSTs, so other sites can't submit as you
    `Max-Age=${SESSION_DAYS * 86_400}`,
    secure ? "Secure" : "",
  ]
    .filter(Boolean)
    .join("; ");
}
