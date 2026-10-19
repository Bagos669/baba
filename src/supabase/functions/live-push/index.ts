// BABA live-push: the organizer's phone calls this when a match starts, a goal or a save happens,
// or a match ends; an adm's phone calls it when a list is pulled or canceled in a turma (v11). It checks the caller owns the live game (srv_push_claim also drops repeats and
// caps it at 120 an hour), then sends a Web Push to whoever follows that game or is in its turmas.
// v11.4.2: the same function also sends the server's own notices (list opened, eve-of-game reminder, bets settled).
// The database clock (pg_cron, every minute) calls it with the header x-avisos-secret; srv_avisos_pendentes() picks who
// gets what and records each send first, so a retry never repeats a notice. Deploy with "Verify JWT" OFF (this file checks the login itself).
// Secrets: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY (and optionally VAPID_SUBJECT), AVISOS_SECRET (same value as private.avisos_cfg.secret).
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import webpush from "npm:web-push@3.6.7";

const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false, autoRefreshToken: false },
});
webpush.setVapidDetails(
  Deno.env.get("VAPID_SUBJECT") ?? "mailto:contatobabaapp@gmail.com",
  Deno.env.get("VAPID_PUBLIC_KEY")!,
  Deno.env.get("VAPID_PRIVATE_KEY")!,
);

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
const AVISOS_SECRET = Deno.env.get("AVISOS_SECRET") ?? "";
const safeEq = (a: string, b: string) => {
  if (!a || a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
};
// Notices sent by the database clock. Never throws: a failed send only loses that one notice.
async function sendAvisos() {
  const { data, error } = await admin.rpc("srv_avisos_pendentes");
  if (error) return json({ error: "server" }, 500);
  const gone: string[] = [];
  let sent = 0;
  await Promise.allSettled((data || []).map(async (r: { tipo: string; event_id: string; endpoint: string; p256dh: string; auth: string; title: string; body: string }) => {
    const payload = JSON.stringify({
      title: clip(r.title, 80), body: clip(r.body, 160), kind: "aviso", tag: `baba-aviso-${r.tipo}-${r.event_id}`,
      url: r.tipo === "palpites" ? `./#palpites=${r.event_id}` : `./#lista=${r.event_id}`,
    });
    try {
      await webpush.sendNotification({ endpoint: r.endpoint, keys: { p256dh: r.p256dh, auth: r.auth } }, payload,
        { TTL: r.tipo === "palpites" ? 86400 : 21600, urgency: "high" });
      sent++;
    } catch (e) {
      const s = (e as { statusCode?: number }).statusCode;
      if (s === 404 || s === 410) gone.push(r.endpoint);
    }
  }));
  if (gone.length) await admin.rpc("srv_push_gone", { endpoints: gone });
  return json({ sent, gone: gone.length });
}
const KINDS = new Set(["start", "goal", "save", "end", "event", "event_cancel"]);
const clip = (v: unknown, n: number) => String(v ?? "").replace(/[\u0000-\u001f]/g, " ").trim().slice(0, n);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "method" }, 405);
  const avisosKey = req.headers.get("x-avisos-secret");
  if (avisosKey !== null) return safeEq(avisosKey, AVISOS_SECRET) ? await sendAvisos() : json({ error: "unauthorized" }, 401);
  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  const { data: who } = await admin.auth.getUser(token);
  if (!who?.user) return json({ error: "unauthorized" }, 401);

  let b: Record<string, unknown> = {};
  try { b = await req.json(); } catch { return json({ error: "bad_json" }, 400); }
  const kind = clip(b.kind, 14), key = clip(b.key, 80), code = clip(b.code, 12).replace(/[^A-Za-z0-9]/g, "");
  const title = clip(b.title, 80), body = clip(b.body, 160);
  // A list pulled in a turma (v11) or a live game (v10.1).
  const event = clip(b.event_id, 40), live = clip(b.live_id, 40);
  const isEvent = kind.startsWith("event");
  const id = isEvent ? event : live;
  if (!/^[0-9a-f-]{36}$/.test(id) || !KINDS.has(kind) || !key || !title) return json({ error: "bad_request" }, 400);

  const { data: claim, error: ce } = isEvent
    ? await admin.rpc("srv_event_claim", { event, caller: who.user.id, push_key: key })
    : await admin.rpc("srv_push_claim", { live, caller: who.user.id, push_key: key });
  if (ce) return json({ error: "server" }, 500);
  if (claim !== "ok") return json({ sent: 0, reason: claim });

  const { data: targets, error: te } = isEvent
    ? await admin.rpc("srv_event_targets", { event, caller: who.user.id })
    : await admin.rpc("srv_push_targets", { live });
  if (te) return json({ error: "server" }, 500);
  const url = isEvent ? `./#lista=${event}` : code ? `./#ao-vivo=${code}` : "./";
  const payload = JSON.stringify({ title, body, kind, tag: isEvent ? `baba-lista-${event}` : `baba-${code}-${kind === "end" ? "end" : key}`, url });
  const gone: string[] = [];
  let sent = 0;
  await Promise.allSettled((targets || []).map(async (t: { endpoint: string; p256dh: string; auth: string }) => {
    try {
      await webpush.sendNotification({ endpoint: t.endpoint, keys: { p256dh: t.p256dh, auth: t.auth } }, payload,
        { TTL: kind === "end" || isEvent ? 21600 : 600, urgency: "high" });
      sent++;
    } catch (e) {
      const s = (e as { statusCode?: number }).statusCode;
      if (s === 404 || s === 410) gone.push(t.endpoint);
    }
  }));
  if (gone.length) await admin.rpc("srv_push_gone", { endpoints: gone });
  return json({ sent, gone: gone.length });
});
