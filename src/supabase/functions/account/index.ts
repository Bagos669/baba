// BABA account helper.
// Supabase's built-in e-mail only reaches the project team, so instead of
// e-mail confirmation and reset links this function:
//   signup      -> creates an already-confirmed account and a recovery code
//   reset       -> sets a new password when e-mail + recovery code match
//   new_code    -> (signed in) issues a fresh recovery code
//   delete      -> (signed in) deletes the caller's account
// Support account only (checked with srv_is_staff, every call logged):
//   staff_code     -> new recovery code for a user (to read to them after checking who they are)
//   staff_password -> sets a temporary password for a user
//   staff_block    -> blocks / unblocks sign-in (hours = 0 unblocks)
//   staff_delete   -> deletes a user's account
// Signup/reset are public by design; the rest check the caller's token.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
const fail = (code: string, status = 400) => json({ error: code }, status);

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const enc = new TextEncoder();

function b64(bytes: Uint8Array) {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}
function fromB64(s: string) {
  const bin = atob(s);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}
const normCode = (c: string) => String(c || "").toUpperCase().replace(/[^A-Z0-9]/g, "");

function makeCode() {
  const r = crypto.getRandomValues(new Uint8Array(12));
  let c = "";
  for (const b of r) c += ALPHABET[b % ALPHABET.length];
  return `${c.slice(0, 4)}-${c.slice(4, 8)}-${c.slice(8)}`;
}

async function hash(code: string, salt: Uint8Array) {
  const key = await crypto.subtle.importKey("raw", enc.encode(normCode(code)), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: 100000 }, key, 256);
  return b64(new Uint8Array(bits));
}

function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

async function issueCode(userId: string, email: string) {
  const code = makeCode();
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const { error } = await admin.rpc("srv_set_recovery", { uid: userId, mail: email, s: b64(salt), h: await hash(code, salt) });
  if (error) throw error;
  return code;
}

async function callerFrom(req: Request) {
  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) return null;
  const { data, error } = await admin.auth.getUser(token);
  return error ? null : data.user;
}

async function isStaff(uid: string) {
  const { data, error } = await admin.rpc("srv_is_staff", { uid });
  return !error && data === true;
}

async function staffLog(staff: string, what: string, target: string, details: Record<string, unknown> | null) {
  await admin.rpc("srv_staff_log", { staff, what, target, details });
}

const validEmail = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e);
const validUuid = (s: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return fail("method", 405);

  let body: Record<string, string>;
  try { body = await req.json(); } catch { return fail("bad_json"); }
  const action = body.action;

  try {
    if (action === "signup") {
      const name = String(body.name || "").trim().replace(/\s+/g, " ").slice(0, 60);
      const email = String(body.email || "").trim().toLowerCase();
      const password = String(body.password || "");
      if (!name) return fail("name_required");
      if (!validEmail(email)) return fail("invalid_email");
      if (password.length < 6) return fail("weak_password");
      const { data, error } = await admin.auth.admin.createUser({
        email, password, email_confirm: true, user_metadata: { name },
      });
      if (error) {
        const msg = (error.message || "").toLowerCase();
        if (msg.includes("already") || (error as { status?: number }).status === 422) return fail("email_taken", 409);
        if (msg.includes("password")) return fail("weak_password");
        throw error;
      }
      const code = await issueCode(data.user.id, email);
      return json({ ok: true, code });
    }

    if (action === "reset") {
      const email = String(body.email || "").trim().toLowerCase();
      const password = String(body.password || "");
      if (password.length < 6) return fail("weak_password");
      const { data: rows, error } = await admin.rpc("srv_get_recovery", { mail: email });
      if (error) throw error;
      const rec = rows && rows[0];
      // Same answer for unknown e-mail and wrong code.
      if (!rec) return fail("invalid_code", 401);
      if (rec.locked_until && new Date(rec.locked_until) > new Date()) return fail("locked", 429);
      const ok = safeEqual(await hash(body.code, fromB64(rec.salt)), rec.hash);
      await admin.rpc("srv_recovery_attempt", { uid: rec.user_id, ok });
      if (!ok) return fail("invalid_code", 401);
      const { error: upErr } = await admin.auth.admin.updateUserById(rec.user_id, { password });
      if (upErr) throw upErr;
      return json({ ok: true });
    }

    if (action === "new_code") {
      const user = await callerFrom(req);
      if (!user) return fail("unauthorized", 401);
      const code = await issueCode(user.id, user.email || "");
      return json({ ok: true, code });
    }

    if (action === "delete") {
      const user = await callerFrom(req);
      if (!user) return fail("unauthorized", 401);
      const { error: prepErr } = await admin.rpc("srv_prepare_account_deletion", { uid: user.id });
      if (prepErr) throw prepErr;
      const { error: delErr } = await admin.auth.admin.deleteUser(user.id);
      if (delErr) throw delErr;
      return json({ ok: true });
    }

    if (typeof action === "string" && action.startsWith("staff_")) {
      const user = await callerFrom(req);
      if (!user) return fail("unauthorized", 401);
      if (!(await isStaff(user.id))) return fail("not_staff", 403);
      const target = String(body.user_id || "");
      if (!validUuid(target)) return fail("bad_user");
      const { data: found, error: findErr } = await admin.auth.admin.getUserById(target);
      if (findErr || !found?.user) return fail("not_found", 404);
      const targetIsStaff = await isStaff(target);

      if (action === "staff_code") {
        const code = await issueCode(target, found.user.email || "");
        await staffLog(user.id, "novo-codigo", target, null);
        return json({ ok: true, code });
      }

      if (action === "staff_password") {
        const password = String(body.password || "");
        if (password.length < 6) return fail("weak_password");
        if (targetIsStaff && target !== user.id) return fail("is_staff", 403);
        const { error } = await admin.auth.admin.updateUserById(target, { password });
        if (error) throw error;
        await staffLog(user.id, "senha-provisoria", target, null);
        return json({ ok: true });
      }

      if (action === "staff_block") {
        if (targetIsStaff) return fail("is_staff", 403);
        const hours = Math.max(0, Math.min(876000, Math.floor(Number(body.hours) || 0)));
        const { error } = await admin.auth.admin.updateUserById(target, { ban_duration: hours ? `${hours}h` : "none" });
        if (error) throw error;
        await staffLog(user.id, hours ? "bloquear-login" : "liberar-login", target, { horas: hours });
        return json({ ok: true });
      }

      if (action === "staff_delete") {
        if (targetIsStaff) return fail("is_staff", 403);
        const { error: prepErr } = await admin.rpc("srv_prepare_account_deletion", { uid: target });
        if (prepErr) throw prepErr;
        const { error: delErr } = await admin.auth.admin.deleteUser(target);
        if (delErr) throw delErr;
        await staffLog(user.id, "excluir-conta", target, { email: found.user.email });
        return json({ ok: true });
      }
    }

    return fail("unknown_action");
  } catch (e) {
    console.error(action, e);
    return fail("server_error", 500);
  }
});
