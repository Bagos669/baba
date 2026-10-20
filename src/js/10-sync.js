    /* ===================================================================
       CONTA E NUVEM
       Accounts and shared data live in Supabase. The app keeps a full copy
       of the current baba on the phone (works offline at the court) and
       sends changes through an outbox that retries until it reaches the
       server. Turmas and their rosters are shared with every member.
       =================================================================== */
    const SUPABASE_URL = 'https://gwndkwnodlfgbcpesenr.supabase.co';
    const SUPABASE_KEY = 'sb_publishable_f-zeNQEVrZb8VIpFl_HPaA_zhhIPXFa';
    const ACCOUNT_FN = SUPABASE_URL + '/functions/v1/account';
    const CACHE_PREFIX = 'baba_cache_v5:';
    const OUTBOX_PREFIX = 'baba_outbox_v5:';
    const LOCK_PREFIX = 'baba_lock_v5:';
    const IMPORTED_PREFIX = 'baba_local_imported_v5:';
    const LEGACY_ACCOUNTS_KEY = 'baba_accounts_v1';
    const INVITE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

    let sb = null;
    try {
      if (window.supabase && window.supabase.createClient) {
        sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
          auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storageKey: 'baba_auth_v5' }
        });
      }
    } catch (e) { sb = null; }

    let currentUser = null;      // { id, email, name }
    let pendingSignup = null;    // { session, code }
    let pendingLockUser = null;
    let syncing = false;
    let syncState = 'ok';        // ok | syncing | offline | error
    let retryTimer = null;
    let pushTimer = null;
    let lastPull = 0;
    let myPlayerIds = [];
    let relinkTried = false;
    let othersOpen = [];         // babas in progress on other organizers' phones (my turmas)
    let schemaV2 = null;         // server has owners/pictures/prefs (null = not checked yet)
    let femaleCol = null;        // server keeps "jogadora" on turma players (v9.5)
    let penCol = null;           // server keeps penalty numbers (v10)
    let eventCol = null;         // server links babas to lists (v11.4)
    let sharedOff = false;       // server without the v11.6 functions (baba compartilhado)
    let lanceSeqParam = null;    // server's baba_save takes p_lance_seq (v11.6.1)
    const isMissingColumn = e => !!e && (e.code === '42703' || e.code === 'PGRST200' || e.code === 'PGRST204' || /column|schema cache/i.test(String(e.message || '')));

    const enc = new TextEncoder();
    const cryptoOk = () => !!(window.crypto && crypto.subtle && crypto.getRandomValues);

    function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
    function lsSet(k, v) { try { localStorage.setItem(k, v); return true; } catch (e) { return false; } }
    function lsDel(k) { try { localStorage.removeItem(k); } catch (e) {} }

    function randBytes(n) {
      const a = new Uint8Array(n);
      if (window.crypto && crypto.getRandomValues) crypto.getRandomValues(a);
      else for (let i = 0; i < n; i++) a[i] = Math.floor(Math.random() * 256);
      return a;
    }
    function b64u(buf) {
      const bytes = new Uint8Array(buf);
      let s = '';
      for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
      return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    }
    function fromB64u(str) {
      let s = String(str).replace(/-/g, '+').replace(/_/g, '/');
      while (s.length % 4) s += '=';
      const bin = atob(s);
      const out = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
      return out;
    }
    function uuid() {
      if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
      const b = randBytes(16);
      b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
      const h = [...b].map(x => x.toString(16).padStart(2, '0')).join('');
      return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
    }
    /* Same text -> same id, so importing a file twice doesn't duplicate a baba. */
    function uuidFromString(text) {
      const out = [];
      let h1 = 0x811c9dc5, h2 = 0x01000193, h3 = 0x9e3779b9, h4 = 0x85ebca6b;
      for (let i = 0; i < text.length; i++) {
        const c = text.charCodeAt(i);
        h1 = Math.imul(h1 ^ c, 16777619); h2 = Math.imul(h2 ^ c, 2246822507);
        h3 = Math.imul(h3 ^ c, 3266489909); h4 = Math.imul(h4 ^ c, 668265263);
      }
      [h1, h2, h3, h4].forEach(h => out.push(((h >>> 0).toString(16)).padStart(8, '0')));
      const hx = out.join('');
      return `${hx.slice(0, 8)}-${hx.slice(8, 12)}-5${hx.slice(13, 16)}-a${hx.slice(17, 20)}-${hx.slice(20, 32)}`;
    }
    const isUuid = s => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(s));
    const localDate = ms => { const d = ms ? new Date(ms) : new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
    const validEmail = e => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e);

    /* ---- Server calls (one place, so tests can swap it) ---- */
    async function q(builder) {
      const { data, error } = await builder;
      if (error) throw error;
      return data || [];
    }

    async function callAccountFn(body, withAuth) {
      const headers = { 'Content-Type': 'application/json', apikey: SUPABASE_KEY };
      if (withAuth) {
        const session = await api.getSession();
        if (!session) return { ok: false, status: 401, body: { error: 'unauthorized' } };
        headers.Authorization = 'Bearer ' + session.access_token;
      }
      const res = await fetch(ACCOUNT_FN, { method: 'POST', headers, body: JSON.stringify(body) });
      let data = {};
      try { data = await res.json(); } catch (e) {}
      return { ok: res.ok, status: res.status, body: data };
    }

    // Tests can stand in for the server by defining window.__BABA_FAKE_API__ before load.
    const api = Object.assign({
      enabled: () => !!sb,
      signup: (name, email, password) => callAccountFn({ action: 'signup', name, email, password }),
      reset: (email, code, password) => callAccountFn({ action: 'reset', email, code, password }),
      newCode: () => callAccountFn({ action: 'new_code' }, true),
      deleteAccount: () => callAccountFn({ action: 'delete' }, true),
      async signIn(email, password) {
        const { data, error } = await sb.auth.signInWithPassword({ email, password });
        if (error) throw error;
        return data.session;
      },
      async signOut() { try { await sb.auth.signOut({ scope: 'local' }); } catch (e) {} },
      async getSession() { const { data } = await sb.auth.getSession(); return data ? data.session : null; },
      async updatePassword(password) { const { error } = await sb.auth.updateUser({ password }); if (error) throw error; },
      async memberships(uid) {
        // New columns (owner, icon) arrive with a server update; read the old shape until then.
        if (schemaV2 !== false) {
          const { data, error } = await sb.from('turma_members').select('role, turma:turmas(id, name, invite_code, created_by, owner_id, icon)').eq('user_id', uid);
          if (!error) { schemaV2 = true; return data || []; }
          if (!isMissingColumn(error)) throw error;
          schemaV2 = false;
        }
        return q(sb.from('turma_members').select('role, turma:turmas(id, name, invite_code, created_by)').eq('user_id', uid));
      },
      async players(ids) {
        if (!ids.length) return [];
        // "Jogadora" arrives with a server update (v9.5); read the old shape until then.
        if (femaleCol !== false) {
          const { data, error } = await sb.from('turma_players').select('id, turma_id, name, is_goalkeeper, is_female, user_id').in('turma_id', ids).order('created_at');
          if (!error) { femaleCol = true; return data || []; }
          if (!isMissingColumn(error)) throw error;
          femaleCol = false;
        }
        return q(sb.from('turma_players').select('id, turma_id, name, is_goalkeeper, user_id').in('turma_id', ids).order('created_at'));
      },
      openBaba: uid => q(sb.from('babas').select('id, state, updated_at').eq('created_by', uid).eq('finished', false).order('updated_at', { ascending: false }).limit(1)),
      // Babas still being played in my turmas (by other organizers): "Meus números" counts them live.
      turmaOpenBabas: () => q(sb.from('babas').select('id, title, created_by, state, updated_at').eq('finished', false).gt('updated_at', new Date(Date.now() - 2 * 864e5).toISOString()).order('updated_at', { ascending: false }).limit(20)),
      async finishedBabas() {
        const run = cols => sb.from('babas').select(`id, title, played_on, matches, created_by, turma_ids, venue:state->>venue, baba_stats(${cols})`).eq('finished', true).order('played_on', { ascending: false }).limit(150);
        const base = 'name, goals, assists, saves, matches, wins, turma_player_id';
        if (penCol !== false) {
          const { data, error } = await run(base + ', pen_goals, pen_misses, pen_saves');
          if (!error) { penCol = true; return data || []; }
          if (!isMissingColumn(error)) throw error;
          penCol = false;
        }
        return q(run(base));
      },
      async profile(uid) {
        if (schemaV2 !== false) {
          const { data, error } = await sb.from('profiles').select('name, avatar, prefs').eq('id', uid).limit(1);
          if (!error) return (data || [])[0] || null;
          if (!isMissingColumn(error)) throw error;
        }
        return (await q(sb.from('profiles').select('name').eq('id', uid).limit(1)))[0] || null;
      },
      async updateProfile(uid, patch) {
        const row = {};
        if (patch.name) row.name = patch.name;
        if (schemaV2) {
          if ('avatar' in patch) row.avatar = patch.avatar;
          if (patch.prefs) row.prefs = patch.prefs;
        }
        if (Object.keys(row).length) await q(sb.from('profiles').update(row).eq('id', uid));
        if (patch.name) { try { await sb.auth.updateUser({ data: { name: patch.name } }); } catch (e) {} }
      },
      async signOutOthers() { const { error } = await sb.auth.signOut({ scope: 'others' }); if (error) throw error; },
      async roster(id) { const { data, error } = await sb.rpc('turma_roster', { t: id }); if (error) throw error; return data || []; },
      async setRole(id, member, role) { const { error } = await sb.rpc('set_member_role', { t: id, member, new_role: role }); if (error) throw error; },
      async transfer(id, member) { const { error } = await sb.rpc('transfer_turma', { t: id, member }); if (error) throw error; },
      async removeMember(id, member) { const { error } = await sb.rpc('remove_member', { t: id, member }); if (error) throw error; },
      // event_id chega com o SQL da v11.4; até lá o baba segue sem a ligação com a lista.
      async upsertBaba(row) {
        if (!('event_id' in row)) return q(sb.from('babas').upsert(row));
        const plain = Object.assign({}, row); delete plain.event_id;
        if (eventCol === false) return q(sb.from('babas').upsert(plain));
        const { error } = await sb.from('babas').upsert(row);
        if (!error) { eventCol = true; return; }
        if (!isMissingColumn(error)) throw error;
        eventCol = false;
        await q(sb.from('babas').upsert(plain));
      },
      // v11.6: o baba compartilhado entre dono e adms grava por RPC (com versão) e finaliza uma vez só.
      async saveBaba(row, baseRev, lanceSeq) {
        const args = { p_id: row.id, p_state: row.state, p_turma_ids: row.turma_ids, p_title: row.title, p_played_on: row.played_on,
          p_matches: row.matches, p_event_id: row.event_id || null, p_base_rev: baseRev == null ? null : baseRev };
        // p_lance_seq chega com o SQL da v11.6.1; até lá grava como na v11.6.
        if (lanceSeqParam !== false) {
          try { const r = await rpcCall('baba_save', Object.assign({ p_lance_seq: lanceSeq == null ? null : lanceSeq }, args)); lanceSeqParam = true; return r; }
          catch (e) { if (!isMissingFn(e)) throw e; lanceSeqParam = false; }
        }
        return rpcCall('baba_save', args);
      },
      finishBaba: (row, stats) => rpcCall('baba_finish', { p_id: row.id, p_state: row.state, p_turma_ids: row.turma_ids, p_title: row.title, p_played_on: row.played_on,
        p_matches: row.matches, p_event_id: row.event_id || null, p_stats: stats || [] }),
      babaRev: id => rpcCall('baba_rev', { p_id: id }),
      babaGet: id => rpcCall('baba_get', { p_id: id }),
      babasShared: () => rpcCall('babas_shared'),
      // v11.6.1: lances só pelo anotador; assumir a anotação e passar a vez (mesário).
      lanceBaba: (id, lance) => rpcCall('baba_lance', { p_baba: id, p_lance: lance }),
      takeScoring: id => rpcCall('baba_take_scoring', { p_baba: id }),
      setMesario: (id, user) => rpcCall('baba_set_mesario', { p_baba: id, p_user: user }),
      async babaGames(id) { const r = await q(sb.from('babas').select('state').eq('id', id).limit(1)); return (r[0] && r[0].state && Array.isArray(r[0].state.games)) ? r[0].state.games : []; },
      deleteBaba: id => q(sb.from('babas').delete().eq('id', id)),
      async replaceStats(babaId, rows) {
        await q(sb.from('baba_stats').delete().eq('baba_id', babaId));
        if (!rows.length) return;
        // Penalty columns arrive with the v10 server update; send without them until then.
        const plain = rows.map(r => { const x = Object.assign({}, r); delete x.pen_goals; delete x.pen_misses; delete x.pen_saves; return x; });
        if (penCol === false) return q(sb.from('baba_stats').insert(plain));
        const { error } = await sb.from('baba_stats').insert(rows);
        if (!error) { penCol = true; return; }
        if (!isMissingColumn(error)) throw error;
        penCol = false;
        await q(sb.from('baba_stats').insert(plain));
      },
      upsertTurma: (id, name, icon) => q(sb.from('turmas').upsert(schemaV2 ? { id, name, icon: icon || null } : { id, name })),
      turmaInvite: async id => ((await q(sb.from('turmas').select('invite_code').eq('id', id).limit(1)))[0] || {}).invite_code || null,
      setInvite: (id, code) => q(sb.from('turmas').update({ invite_code: code }).eq('id', id)),
      deleteTurma: id => q(sb.from('turmas').delete().eq('id', id)),
      async leaveTurma(id, uid) {
        if (schemaV2) { const { error } = await sb.rpc('remove_member', { t: id, member: uid }); if (error) throw error; return; }
        return q(sb.from('turma_members').delete().eq('turma_id', id).eq('user_id', uid));
      },
      insertPlayers: rows => q(sb.from('turma_players').insert(rows)),
      deletePlayers: ids => q(sb.from('turma_players').delete().in('id', ids)),
      setKeeper: (id, value) => q(sb.from('turma_players').update({ is_goalkeeper: value }).eq('id', id)),
      setFemale: (id, value) => q(sb.from('turma_players').update({ is_female: value }).eq('id', id)),
      renamePlayer: (turmaId, oldName, newName) => q(sb.from('turma_players').update({ name: newName }).eq('turma_id', turmaId).eq('name', oldName)),
      async join(code) { const { data, error } = await sb.rpc('join_turma', { code }); if (error) throw error; return data || []; },
      async claim(id) { const { error } = await sb.rpc('claim_player', { player: id }); if (error) throw error; },
      async unclaim(id) { const { error } = await sb.rpc('unclaim_player', { player: id }); if (error) throw error; }
    }, window.__BABA_FAKE_API__ || {});

    const cloudOn = () => !!(currentUser && api.enabled());
    async function rpcCall(name, args) {
      const { data, error } = await sb.rpc(name, args || {});
      if (error) throw error;
      return data;
    }

    function isNetworkError(e) {
      if (!e) return false;
      if (navigator.onLine === false) return true;
      const m = String(e.message || e).toLowerCase();
      return !e.code && (m.includes('fetch') || m.includes('network') || m.includes('load failed') || m.includes('timeout'));
    }

    /* ---- Sync status (the dot on the avatar) ---- */
    function setSync(s) {
      syncState = s;
      const dot = document.getElementById('sync-dot');
      if (dot) {
        dot.classList.toggle('bg-leaf', s === 'ok');
        dot.classList.toggle('bg-butter-3', s === 'syncing' || s === 'offline');
        dot.classList.toggle('bg-danger', s === 'error');
      }
      const label = document.getElementById('profile-sync');
      if (label) {
        const pending = currentUser ? readOutbox().length : 0;
        label.innerText = s === 'syncing' ? 'Sincronizando...'
          : s === 'offline' ? `Sem internet: ${pending ? pending + ' alteraç' + (pending === 1 ? 'ão' : 'ões') + ' esperando' : 'tudo salvo neste aparelho'}`
          : s === 'error' ? 'Não consegui sincronizar. Tento de novo sozinho.'
          : 'Tudo sincronizado';
      }
    }

    /* ---- Outbox ---- */
    const outboxKey = () => OUTBOX_PREFIX + (currentUser ? currentUser.id : 'none');
    function readOutbox() { try { return JSON.parse(lsGet(outboxKey()) || '[]'); } catch (e) { return []; } }
    function writeOutbox(ops) { lsSet(outboxKey(), JSON.stringify(ops)); }

    function enqueue(op) {
      if (!cloudOn()) return;
      op.uid = uuid();
      let ops = readOutbox();
      // Later writes of the same thing replace earlier ones that haven't gone out.
      if (op.type === 'baba_upsert') ops = ops.filter(o => !(o.type === 'baba_upsert' && o.id === op.id));
      if (op.type === 'baba_finish' || op.type === 'baba_delete') ops = ops.filter(o => !((o.type === 'baba_upsert' || o.type === 'baba_finish') && o.id === op.id));
      if (op.type === 'turma_sync') ops = ops.filter(o => !(o.type === 'turma_sync' && o.id === op.id));
      if (op.type === 'turma_delete' || op.type === 'turma_leave') ops = ops.filter(o => !(['turma_sync', 'player_rename'].includes(o.type) && (o.id === op.id || o.turmaId === op.id)));
      ops.push(op);
      writeOutbox(ops);
      flushOutbox();
    }

    function scheduleRetry(ms) {
      clearTimeout(retryTimer);
      retryTimer = setTimeout(flushOutbox, ms || 15000);
    }

    async function flushOutbox() {
      if (!cloudOn() || syncing) return;
      if (!readOutbox().length) { if (syncState !== 'error') setSync('ok'); return; }
      if (navigator.onLine === false) { setSync('offline'); return; }
      syncing = true;
      setSync('syncing');
      const owner = currentUser.id;
      try {
        let ops = readOutbox();
        while (ops.length && currentUser && currentUser.id === owner) {
          const op = ops[0];
          try {
            await runOp(op);
          } catch (e) {
            if (isNetworkError(e)) throw e;
            // The server refused it (permission, invalid data): drop it so the line keeps moving.
            console.warn('BABA sync dropped', op.type, e);
            showToast(op.type.startsWith('turma') || op.type === 'player_rename' ? 'Só o dono ou um adm pode mudar a turma.' : 'Uma alteração não foi aceita pelo servidor.', 'warning');
          }
          writeOutbox(readOutbox().filter(o => o.uid !== op.uid));
          ops = readOutbox();
        }
        setSync('ok');
      } catch (e) {
        setSync(isNetworkError(e) ? 'offline' : 'error');
        scheduleRetry();
      } finally {
        syncing = false;
      }
    }

    async function runOp(op) {
      if (op.type === 'baba_upsert') {
        if (!sharedOff) {
          try { return handleSaveResult(op.row.id, await api.saveBaba(op.row, op.baseRev, op.lanceSeq)); }
          catch (e) {
            // Chegou um lance que este aparelho ainda não viu: volta para o estado do servidor (nada se perde).
            if (/stale_lances/.test(String(e.message || ''))) { refetchShared(op.row.id, 'stale'); return; }
            if (!isMissingFn(e)) throw e;
            sharedOff = true;
          }
        }
        return api.upsertBaba(op.row);
      }
      if (op.type === 'baba_finish') {
        if (!sharedOff) {
          try {
            const r = await api.finishBaba(op.row, op.stats || []);
            if (r && r.already && r.finished_by !== currentUser.id) showToast(`Esse baba já tinha sido finalizado por ${firstName(r.finished_by_name || 'outra pessoa')}.`, 'warning');
            return;
          } catch (e) { if (!isMissingFn(e)) throw e; sharedOff = true; }
        }
        await api.upsertBaba(op.row);
        return api.replaceStats(op.row.id, op.stats || []);
      }
      if (op.type === 'baba_delete') return api.deleteBaba(op.id);
      if (op.type === 'turma_delete') return api.deleteTurma(op.id);
      if (op.type === 'turma_leave') return api.leaveTurma(op.id, currentUser.id);
      if (op.type === 'player_rename') return api.renamePlayer(op.turmaId, op.oldName, op.newName);
      if (op.type === 'turma_sync') return syncTurmaNow(op.id);
      if (op.type === 'profile_update') return api.updateProfile(currentUser.id, op.patch || {});
      if (op.type === 'live_settle') return api.settlePalpites(op.liveId, op.matchNo, op.result);
      if (op.type === 'live_end') return api.updateLive(op.id, { active: false, markets: { open: false } });
    }

    /* Makes the server roster match the local one (names, goalkeepers). */
    async function syncTurmaNow(id) {
      const t = state.turmas.find(x => x.id === id);
      if (!t) return;
      await api.upsertTurma(t.id, t.name, t.icon);
      const rows = await api.players([t.id]);
      const local = new Map(t.players.map(n => [n.trim().toLowerCase(), n]));
      const remove = rows.filter(r => !local.has(r.name.toLowerCase())).map(r => r.id);
      if (remove.length) await api.deletePlayers(remove);
      const have = new Set(rows.map(r => r.name.toLowerCase()));
      const add = [...local.values()].filter(n => !have.has(n.toLowerCase()))
        .map(n => Object.assign({ turma_id: t.id, name: n, is_goalkeeper: t.keepers.some(k => sameName(k, n)) },
          femaleCol ? { is_female: (t.women || []).some(k => sameName(k, n)) } : {}));
      if (add.length) await api.insertPlayers(add);
      for (const r of rows) {
        if (!local.has(r.name.toLowerCase())) continue;
        const gk = t.keepers.some(k => sameName(k, r.name));
        if (gk !== !!r.is_goalkeeper) await api.setKeeper(r.id, gk);
      }
      // Refresh ids and links for this turma (and who is a "jogadora", once the server keeps it).
      const fresh = await api.players([t.id]);
      if (fresh.length && 'is_female' in fresh[0]) femaleCol = true;
      for (const r of fresh) {
        if (!('is_female' in r) || !local.has(r.name.toLowerCase())) continue;
        const f = (t.women || []).some(k => sameName(k, r.name));
        if (f !== !!r.is_female) { await api.setFemale(r.id, f); r.is_female = f; }
      }
      const live = state.turmas.find(x => x.id === id);
      if (live) {
        live.meta = Object.fromEntries(fresh.map(r => [r.name.toLowerCase(), { id: r.id, userId: r.user_id }]));
        if (!live.invite) live.invite = await api.turmaInvite(t.id);
        cacheState();
      }
    }

    function markTurmaDirty(id) {
      const t = turmaById(id);
      if (!t || !cloudOn()) return;
      if (!canEditTurma(t)) return;
      enqueue({ type: 'turma_sync', id });
    }

    /* ---- The current baba on the server ---- */
    function hasBabaContent() {
      return state.players.some(p => p.present) || state.matchHistory.length > 0 || state.match.events.length > 0;
    }
    const cloudTurmaIds = ids => (ids || []).filter(id => isUuid(id) && state.turmas.some(t => t.id === id && t.cloud));
    function babaTitle() {
      const names = state.selectedTeams.map(id => (turmaById(id) || {}).name).filter(Boolean);
      return names.join(' + ') || 'Baba';
    }
    function stateForCloud() {
      const s = Object.assign({}, state);
      delete s.turmas;
      delete s.pastDays;
      delete s.lastFinish;
      delete s.rev;
      delete s.createdBy;
      delete s.lanceSeq;
      return JSON.parse(JSON.stringify(s));
    }

    function schedulePush() {
      if (!cloudOn()) return;
      clearTimeout(pushTimer);
      pushTimer = setTimeout(() => {
        pushTimer = null;
        if (!cloudOn() || !hasBabaContent() || !canPushBaba()) return;
        if (!state.babaId) { state.babaId = uuid(); state.createdBy = currentUser.id; cacheState(); }
        // O baba que começa a partir da lista do dia fica ligado a ela (palpites pré-jogo).
        if (!state.eventId) { const te = todaysEvent(); if (te) { state.eventId = te.id; cacheState(); try { renderSheetTable(); } catch (e) {} } }
        const row = { id: state.babaId, turma_ids: cloudTurmaIds(state.selectedTeams), title: babaTitle(), played_on: localDate(state.startedAt), state: stateForCloud(), finished: false, matches: state.matchHistory.length };
        if (state.eventId) row.event_id = state.eventId;
        enqueue({ type: 'baba_upsert', id: state.babaId, row, baseRev: state.rev || 0, lanceSeq: state.lanceSeq || 0 });
      }, 1200);
    }
    /* Sends the open baba right away (before this phone switches to another one). */
    function pushNow() {
      if (!pushTimer) return;
      pushBabaNow();
    }
    function pushBabaNow() {
      clearTimeout(pushTimer); pushTimer = null;
      if (!cloudOn() || !hasBabaContent() || !state.babaId || !canPushBaba()) return;
      const row = { id: state.babaId, turma_ids: cloudTurmaIds(state.selectedTeams), title: babaTitle(), played_on: localDate(state.startedAt), state: stateForCloud(), finished: false, matches: state.matchHistory.length };
      if (state.eventId) row.event_id = state.eventId;
      enqueue({ type: 'baba_upsert', id: state.babaId, row, baseRev: state.rev || 0, lanceSeq: state.lanceSeq || 0 });
    }

    function playerCloudId(p) {
      const t = turmaById(p.turmaId);
      const m = t && t.meta ? t.meta[p.name.trim().toLowerCase()] : null;
      return m ? m.id : null;
    }

    /* Called with the day's summary before the state is reset. */
    function enqueueFinish(summary) {
      if (!cloudOn()) return;
      const id = summary.id;
      enqueue({
        type: 'baba_finish', id,
        row: Object.assign({ id, turma_ids: cloudTurmaIds(summary.turmaIds), title: summary.title, played_on: summary.date.slice(0, 10), state: { venue: summary.venue || '', games: summary.games || [] }, finished: true, matches: summary.matches },
          summary.eventId ? { event_id: summary.eventId } : {}),
        stats: summary.players.map(p => ({
          baba_id: id, turma_player_id: p.cloudId || null, name: p.name,
          goals: p.goals || 0, assists: p.assists || 0, saves: p.saves || 0, matches: p.matches || 0, wins: p.wins || 0,
          pen_goals: p.penGoals || 0, pen_misses: p.penMisses || 0, pen_saves: p.penSaves || 0
        }))
      });
    }

    /* ---- Pull everything this account can see ---- */
    async function pullCloud(force) {
      if (!cloudOn()) return;
      if (!force && Date.now() - lastPull < 20000) return;
      if (navigator.onLine === false) { setSync('offline'); return; }
      lastPull = Date.now();
      const uid = currentUser.id;
      try {
        setSync('syncing');
        const [mem, prof] = await Promise.all([api.memberships(uid), api.profile(uid)]);
        if (!currentUser || currentUser.id !== uid) return;
        const pendingProfile = (readOutbox().find(o => o.type === 'profile_update') || {}).patch || {};
        if (prof) {
          if (prof.name && !pendingProfile.name) currentUser.name = prof.name;
          if ('avatar' in prof && !('avatar' in pendingProfile)) currentUser.avatar = prof.avatar || null;
          adoptServerPrefs(prof.prefs);
          cacheProfile();
        }
        if (mem.some(m => m.turma && 'owner_id' in m.turma)) schemaV2 = true;
        const turmaRows = mem.filter(m => m.turma).map(m => Object.assign({}, m.turma, { role: m.turma.owner_id && m.turma.owner_id === uid ? 'owner' : m.role }));
        const players = await api.players(turmaRows.map(t => t.id));
        myPlayerIds = players.filter(p => p.user_id === uid).map(p => p.id);
        if (myPlayerIds.length && !relinkTried) { relinkTried = true; api.relinkMyStats().catch(() => {}); }

        const ops = readOutbox();
        const pending = new Set(ops.filter(o => o.type === 'turma_sync').map(o => o.id));
        const gone = new Set(ops.filter(o => o.type === 'turma_delete' || o.type === 'turma_leave').map(o => o.id));
        const next = [];
        turmaRows.forEach(tr => {
          if (gone.has(tr.id)) return;
          const rows = players.filter(p => p.turma_id === tr.id);
          const cloud = {
            id: tr.id, name: tr.name, cloud: true, role: tr.role, invite: tr.invite_code,
            players: rows.map(r => r.name), keepers: rows.filter(r => r.is_goalkeeper).map(r => r.name),
            women: rows.length && !('is_female' in rows[0]) ? ((state.turmas.find(t => t.id === tr.id) || {}).women || []) : rows.filter(r => r.is_female).map(r => r.name),
            meta: Object.fromEntries(rows.map(r => [r.name.toLowerCase(), { id: r.id, userId: r.user_id }]))
          };
          const local = state.turmas.find(t => t.id === tr.id);
          if (local && local.people) cloud.people = local.people;
          // Older server without pictures: keep the one chosen on this phone.
          cloud.icon = 'icon' in tr ? (tr.icon || null) : ((local && local.icon) || null);
          // Local edits that haven't reached the server yet win over the server copy.
          next.push(pending.has(tr.id) && local ? Object.assign({}, local, { cloud: true, role: tr.role, invite: tr.invite_code, meta: cloud.meta }) : cloud);
        });
        state.turmas.filter(t => pending.has(t.id) && !next.some(n => n.id === t.id) && !gone.has(t.id)).forEach(t => next.push(t));
        state.turmas = next;
        state.selectedTeams = state.selectedTeams.filter(id => state.turmas.some(t => t.id === id));

        // The open baba: the newer copy wins (the phone may have been offline).
        const open = (await api.openBaba(uid))[0];
        const blocked = new Set(readOutbox().filter(o => o.type === 'baba_finish' || o.type === 'baba_delete').map(o => o.id));
        if (open && open.state && !blocked.has(open.id)) {
          const cloudSaved = open.state.savedAt || 0;
          const localIsSame = state.babaId === open.id;
          if ((!localIsSame && !hasBabaContent()) || (localIsSame && cloudSaved > (state.savedAt || 0))) {
            adoptCloudBaba(open);
            state.createdBy = uid;
          }
        }

        // History of finished babas (yours and your turmas').
        const done = await api.finishedBabas();
        const pendingDays = state.pastDays.filter(d => readOutbox().some(o => o.type === 'baba_finish' && o.id === d.id));
        const oldGames = new Map(state.pastDays.filter(d => d.games).map(d => [d.id, d.games]));
        state.pastDays = pendingDays.concat(done.filter(d => !pendingDays.some(p => p.id === d.id)).map(d => ({
          id: d.id,
          date: `${d.played_on}T12:00:00`,
          title: d.title || 'Baba',
          matches: d.matches || 0,
          owner: d.created_by === uid,
          turmaIds: Array.isArray(d.turma_ids) ? d.turma_ids : [],
          venue: VENUES[d.venue] ? d.venue : '',
          games: oldGames.get(d.id),
          players: (d.baba_stats || []).map(s => ({ name: s.name, cloudId: s.turma_player_id, goals: s.goals, assists: s.assists, saves: s.saves, matches: s.matches, wins: s.wins,
            penGoals: s.pen_goals || 0, penMisses: s.pen_misses || 0, penSaves: s.pen_saves || 0 }))
        })));

        // Today's numbers from babas other people are running right now.
        try {
          const others = await api.turmaOpenBabas();
          othersOpen = (others || []).filter(b => b.created_by !== uid && b.state && Array.isArray(b.state.players) && !state.pastDays.some(d => d.id === b.id))
            .map(b => ({ id: b.id, players: b.state.players.filter(hasStats).map(p => Object.assign({ name: p.name, turmaId: p.turmaId }, Object.fromEntries(STAT_KEYS.map(k => [k, p[k] || 0])))) }));
        } catch (e) {}

        if (state.selectedTeams.length) syncPool();
        repair();
        cacheState();
        renderAllComponents();
        if (document.getElementById('modal-database') && !document.getElementById('modal-database').classList.contains('hidden')) renderTurmaList();
        if (editingTurmaId) renderTurmaEditor();
        setSync(readOutbox().length ? 'syncing' : 'ok');
        flushOutbox();
        loadEvents(true).then(openPendingList);
        loadSharedBabas(true);
      } catch (e) {
        setSync(isNetworkError(e) ? 'offline' : 'error');
        if (!isNetworkError(e)) console.warn('BABA pull failed', e);
      }
    }

    function adoptCloudBaba(row) {
      const keep = { turmas: state.turmas, pastDays: state.pastDays };
      const wasRunning = state.match.isRunning;
      state = migrate(Object.assign({}, row.state, keep, { v: STATE_VERSION }));
      state.babaId = row.id;
      state.lastFinish = null;
      if (state.match.isRunning && state.match.endAt) runTicker();
      else if (wasRunning) { state.match.isRunning = false; state.match.endAt = null; }
      repair();
    }

    /* ---- Installable app (service worker) ---- */
    function registerServiceWorker() {
      if (!('serviceWorker' in navigator) || !location.protocol.startsWith('http')) return;
      let hadController = !!navigator.serviceWorker.controller;
      let reloading = false;
      const reload = () => { if (!reloading) { reloading = true; location.reload(); } };
      // A new version took over. Reload right away unless a match or a sheet is
      // open; then offer it, and reload on its own next time the app is hidden.
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        // The very first install only takes control; nothing to reload.
        if (!hadController) { hadController = true; return; }
        const busy = (state && state.match && state.match.isRunning) || !!document.querySelector('.overlay:not(.hidden), .page:not(.hidden), #tour:not(.hidden)');
        if (!busy) { reload(); return; }
        showToast('BABA atualizado.', 'success', { label: 'Recarregar', fn: reload });
        document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden' && !(state.match && state.match.isRunning)) reload(); });
      });
      navigator.serviceWorker.addEventListener('message', e => {
        const d = e.data || {};
        if (d.type !== 'open') return;
        const l = String(d.url || '').match(/lista=([0-9a-f-]{36})/);
        if (l && currentUser) { openListaFromAviso(l[1]); return; }
        const pa = String(d.url || '').match(/palpites=([0-9a-f-]{36})/);
        if (pa && currentUser) { openPalpitesFromAviso(pa[1]); return; }
        const m = String(d.url || '').match(/ao-vivo=([A-Za-z0-9]{4,12})/);
        if (m && currentUser !== undefined) openLive(m[1].toUpperCase());
      });
      navigator.serviceWorker.register('sw.js').then(reg => {
        if (reg.waiting) reg.waiting.postMessage('skipWaiting');
        setInterval(() => reg.update().catch(() => {}), 30 * 60 * 1000);
      }).catch(() => {});
    }

