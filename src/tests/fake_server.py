import uuid, random, string, itertools
class Fake:
    """In-memory stand-in for the Supabase project, with the same access rules."""
    def __init__(self):
        self.users = {}; self.tokens = {}; self.turmas = {}; self.members = {}; self.players = {}
        self.babas = {}; self.stats = {}; self.offline = False; self.seq = itertools.count(); self.calls = []
        self.profiles = {}
    def err(self, code, msg=None): return {'err': {'code': code, 'message': msg or code}}
    def ok(self, data=None): return {'data': data}
    def code(self): return '-'.join(''.join(random.choice('ABCDEFGHJKLMNPQRSTUVWXYZ23456789') for _ in range(4)) for _ in range(3))
    def norm(self, c): return ''.join(ch for ch in str(c).upper() if ch.isalnum())
    def is_member(self, t, u): return (t, u) in self.members
    def is_admin(self, t, u): return self.members.get((t, u)) == 'admin'
    def is_owner(self, t, u): return t in self.turmas and self.turmas[t].get('owner_id') == u
    def handle(self, name, tok, args):
        self.calls.append(name)
        if self.offline: return {'err': {'message': 'TypeError: Failed to fetch'}}
        uid = self.tokens.get(tok)
        f = getattr(self, 'f_' + name)
        try: return f(uid, *args)
        except PermissionError as e: return self.err('42501', str(e))
    # --- auth
    def f_signup(self, uid, name, email, pw):
        email = email.lower()
        if email in self.users: return self.ok({'ok': False, 'status': 409, 'body': {'error': 'email_taken'}})
        if len(pw) < 6: return self.ok({'ok': False, 'status': 400, 'body': {'error': 'weak_password'}})
        c = self.code(); self.users[email] = {'id': str(uuid.uuid4()), 'pw': pw, 'name': name, 'code': c}
        self.profiles[self.users[email]['id']] = {'name': name, 'avatar': None, 'prefs': {}}
        return self.ok({'ok': True, 'status': 200, 'body': {'ok': True, 'code': c}})
    def session(self, email):
        u = self.users[email]; t = str(uuid.uuid4()); self.tokens[t] = u['id']
        return {'access_token': t, 'user': {'id': u['id'], 'email': email, 'user_metadata': {'name': u['name']}}}
    def f_signIn(self, uid, email, pw):
        u = self.users.get(email.lower())
        if not u or u['pw'] != pw: return self.err('invalid_credentials', 'Invalid login credentials')
        return self.ok(self.session(email.lower()))
    def f_reset(self, uid, email, code, pw):
        u = self.users.get(email.lower())
        if not u or self.norm(code) != self.norm(u['code']): return self.ok({'ok': False, 'status': 401, 'body': {'error': 'invalid_code'}})
        u['pw'] = pw; return self.ok({'ok': True, 'status': 200, 'body': {'ok': True}})
    def email_of(self, uid): return next(e for e, u in self.users.items() if u['id'] == uid)
    def f_newCode(self, uid):
        if not uid: return self.ok({'ok': False, 'status': 401, 'body': {'error': 'unauthorized'}})
        u = self.users[self.email_of(uid)]; u['code'] = self.code(); return self.ok({'ok': True, 'status': 200, 'body': {'ok': True, 'code': u['code']}})
    def f_updatePassword(self, uid, pw): self.users[self.email_of(uid)]['pw'] = pw; return self.ok()
    def f_deleteAccount(self, uid):
        if not uid: return self.ok({'ok': False, 'status': 401, 'body': {'error': 'unauthorized'}})
        for t in [t for t, x in self.turmas.items() if x.get('owner_id') == uid]:
            heirs = sorted([uu for (tt, uu) in self.members if tt == t and uu != uid], key=lambda uu: 0 if self.members[(t, uu)] == 'admin' else 1)
            if heirs: self.members[(t, heirs[0])] = 'admin'; self.turmas[t]['owner_id'] = heirs[0]
            else: self.drop_turma(t)
        for k in [k for k in self.members if k[1] == uid]: del self.members[k]
        for p in self.players.values():
            if p['user_id'] == uid: p['user_id'] = None
        for b in self.babas.values():
            if b['created_by'] == uid: b['created_by'] = None
        del self.users[self.email_of(uid)]
        return self.ok({'ok': True, 'status': 200, 'body': {'ok': True}})
    # --- reads
    def f_profile(self, uid, who):
        if who != uid: return self.ok(None)
        return self.ok(dict(self.profiles[uid]))
    def f_updateProfile(self, uid, who, patch):
        if who != uid: raise PermissionError('profile')
        p = self.profiles[uid]
        for k in ('name', 'avatar', 'prefs'):
            if k in patch: p[k] = patch[k]
        if 'name' in patch: self.users[self.email_of(uid)]['name'] = patch['name']
        return self.ok()
    def f_signOutOthers(self, uid):
        mine = [t for t, u in self.tokens.items() if u == uid]
        for t in mine[:-1]: del self.tokens[t]
        return self.ok()
    def f_roster(self, uid, tid):
        if not self.is_member(tid, uid): return self.err('P0001', 'not_member')
        rows = []
        for (t, u), r in self.members.items():
            if t != tid: continue
            prof = self.profiles.get(u, {})
            player = next((p['name'] for p in self.players.values() if p['turma_id'] == tid and p['user_id'] == u), None)
            rows.append({'user_id': u, 'name': prof.get('name'), 'avatar': prof.get('avatar'), 'role': 'owner' if self.is_owner(tid, u) else r, 'player_name': player})
        rows.sort(key=lambda r: {'owner': 0, 'admin': 1}.get(r['role'], 2))
        return self.ok(rows)
    def f_setRole(self, uid, tid, member, role):
        if not self.is_owner(tid, uid): return self.err('P0001', 'only_owner')
        if member == uid or (tid, member) not in self.members or role not in ('admin', 'member'): return self.err('P0001', 'not_found')
        self.members[(tid, member)] = role; return self.ok()
    def f_transfer(self, uid, tid, member):
        if not self.is_owner(tid, uid): return self.err('P0001', 'only_owner')
        if (tid, member) not in self.members: return self.err('P0001', 'not_found')
        self.members[(tid, member)] = 'admin'; self.turmas[tid]['owner_id'] = member; return self.ok()
    def f_removeMember(self, uid, tid, member):
        r = self.members.get((tid, member))
        if not r: return self.err('P0001', 'not_found')
        if self.is_owner(tid, member): return self.err('P0001', 'owner_must_transfer' if member == uid else 'not_allowed')
        if member != uid:
            if r == 'admin' and not self.is_owner(tid, uid): return self.err('P0001', 'not_allowed')
            if not self.is_admin(tid, uid): return self.err('P0001', 'not_allowed')
        for p in self.players.values():
            if p['turma_id'] == tid and p['user_id'] == member: p['user_id'] = None
        del self.members[(tid, member)]; return self.ok()
    def f_memberships(self, uid, who):
        return self.ok([{'role': r, 'turma': dict(self.turmas[t])} for (t, u), r in self.members.items() if u == uid and t in self.turmas])
    def f_players(self, uid, ids):
        rows = [dict(p) for p in self.players.values() if p['turma_id'] in ids and self.is_member(p['turma_id'], uid)]
        return self.ok(sorted(rows, key=lambda r: r['seq']))
    def can_see(self, b, uid): return b['created_by'] == uid or any(self.is_member(t, uid) for t in b['turma_ids'])
    def f_openBaba(self, uid, who):
        rows = [b for b in self.babas.values() if b['created_by'] == uid and not b['finished']]
        rows.sort(key=lambda b: b['updated'], reverse=True)
        return self.ok([{'id': b['id'], 'state': b['state'], 'updated_at': b['updated']} for b in rows[:1]])
    def f_finishedBabas(self, uid):
        rows = [b for b in self.babas.values() if b['finished'] and self.can_see(b, uid)]
        return self.ok([{'id': b['id'], 'title': b['title'], 'played_on': b['played_on'], 'matches': b['matches'], 'created_by': b['created_by'], 'turma_ids': list(b.get('turma_ids') or []),
                         'baba_stats': [dict(s) for s in self.stats.get(b['id'], [])]} for b in rows])
    # --- babas
    def f_upsertBaba(self, uid, row):
        ex = self.babas.get(row['id'])
        if ex and ex['created_by'] != uid: raise PermissionError('not owner')
        if not all(self.is_member(t, uid) for t in row['turma_ids']): raise PermissionError('turma')
        b = dict(ex or {'created_by': uid}); b.update(row); b['updated'] = next(self.seq); self.babas[row['id']] = b
        return self.ok([])
    def f_deleteBaba(self, uid, bid):
        b = self.babas.get(bid)
        if b and b['created_by'] == uid: del self.babas[bid]; self.stats.pop(bid, None)
        return self.ok([])
    def f_replaceStats(self, uid, bid, rows):
        b = self.babas.get(bid)
        if not b or b['created_by'] != uid: raise PermissionError('stats')
        self.stats[bid] = [dict(r) for r in rows]; return self.ok()
    # --- turmas
    def f_upsertTurma(self, uid, tid, name, icon=None):
        t = self.turmas.get(tid)
        if t:
            if not self.is_admin(tid, uid): raise PermissionError('admin')
            t['name'] = name; t['icon'] = icon
        else:
            self.turmas[tid] = {'id': tid, 'name': name, 'invite_code': self.norm(self.code())[:8], 'created_by': uid, 'owner_id': uid, 'icon': icon}
            self.members[(tid, uid)] = 'admin'
        return self.ok([])
    def f_turmaInvite(self, uid, tid):
        return self.ok(self.turmas[tid]['invite_code'] if tid in self.turmas and self.is_member(tid, uid) else None)
    def f_setInvite(self, uid, tid, code):
        if not self.is_admin(tid, uid): raise PermissionError('admin')
        self.turmas[tid]['invite_code'] = code; return self.ok([])
    def drop_turma(self, tid):
        self.turmas.pop(tid, None)
        for k in [k for k in self.members if k[0] == tid]: del self.members[k]
        for k in [k for k, p in self.players.items() if p['turma_id'] == tid]: del self.players[k]
    def f_deleteTurma(self, uid, tid):
        if not self.is_owner(tid, uid): raise PermissionError('owner')
        self.drop_turma(tid); return self.ok([])
    def f_leaveTurma(self, uid, tid, who):
        return self.f_removeMember(uid, tid, who)
    def f_insertPlayers(self, uid, rows):
        for r in rows:
            if not self.is_admin(r['turma_id'], uid): raise PermissionError('admin')
            if any(p['turma_id'] == r['turma_id'] and p['name'].lower() == r['name'].lower() for p in self.players.values()):
                return self.err('23505', 'duplicate')
        for r in rows:
            pid = str(uuid.uuid4()); self.players[pid] = {'id': pid, 'turma_id': r['turma_id'], 'name': r['name'], 'is_goalkeeper': r['is_goalkeeper'], 'user_id': None, 'seq': next(self.seq)}
            if getattr(self, 'female_col', True): self.players[pid]['is_female'] = bool(r.get('is_female', False))
        return self.ok([])
    def f_deletePlayers(self, uid, ids):
        for i in ids:
            p = self.players.get(i)
            if p and not self.is_admin(p['turma_id'], uid): raise PermissionError('admin')
        for i in ids: self.players.pop(i, None)
        return self.ok([])
    def f_setKeeper(self, uid, pid, v):
        p = self.players[pid]
        if not self.is_admin(p['turma_id'], uid): raise PermissionError('admin')
        p['is_goalkeeper'] = v; return self.ok([])
    def f_renamePlayer(self, uid, tid, old, new):
        if not self.is_admin(tid, uid): raise PermissionError('admin')
        for p in self.players.values():
            if p['turma_id'] == tid and p['name'] == old: p['name'] = new
        return self.ok([])
    def f_join(self, uid, code):
        t = next((t for t in self.turmas.values() if t['invite_code'] == self.norm(code)), None)
        if not t: return self.err('P0001', 'invalid_code')
        self.members.setdefault((t['id'], uid), 'member'); return self.ok([{'id': t['id'], 'name': t['name']}])
    def f_claim(self, uid, pid):
        p = self.players.get(pid)
        if not p or not self.is_member(p['turma_id'], uid): return self.err('P0001', 'not_found')
        if p['user_id'] and p['user_id'] != uid: return self.err('P0001', 'already_claimed')
        for q in self.players.values():
            if q['turma_id'] == p['turma_id'] and q['user_id'] == uid: q['user_id'] = None
        p['user_id'] = uid; return self.ok()
    def f_unclaim(self, uid, pid):
        p = self.players.get(pid)
        if not p or not (p['user_id'] == uid or self.is_admin(p['turma_id'], uid)): return self.err('P0001', 'not_allowed')
        p['user_id'] = None; return self.ok()

# ===================== v7: termos, pontos, lojinha, ao vivo, palpites, chat =====================
import datetime as _dt, math as _math
SHOP = [('frame_bronze','frame','bronze','Moldura Bronze',300),('frame_prata','frame','prata','Moldura Prata',600),('frame_ouro','frame','ouro','Moldura Ouro',1200),
        ('frame_esmeralda','frame','esmeralda','Moldura Esmeralda',2000),('frame_rubi','frame','rubi','Moldura Rubi',3000),('frame_platina','frame','platina','Moldura Platina',4500),
        ('frame_diamante','frame','diamante','Moldura Diamante',6000),('name_bronze','name','bronze','Nome Bronze',200),('name_prata','name','prata','Nome Prata',400),
        ('name_ouro','name','ouro','Nome Dourado',900),('name_esmeralda','name','esmeralda','Nome Esmeralda',1500),('name_rubi','name','rubi','Nome Rubi',2200),
        ('name_platina','name','platina','Nome Platina',3200),('name_diamante','name','diamante','Nome Diamante',4500),('fx_frame_shine','fx',None,'Brilho na moldura',2500),('fx_name_shine','fx',None,'Brilho no nome',2000)]

def _v7init(self):
    if hasattr(self, 'acct'): return
    self.acct = {}; self.wallets = {}; self.ledger_rows = []; self.items = {}; self.lives = {}; self.palps = []; self.chat = []; self.reports = set()
    self.v7_enabled = True
Fake._v7init = _v7init

def _need(self, uid):
    self._v7init()
    if not self.v7_enabled: raise LookupError()
    if not uid: raise PermissionError('not_authenticated')
def _adult(self, uid):
    b = self.acct.get(uid, {}).get('birth')
    if not b: return False
    t = _dt.date.today(); return (t.year - b.year - ((t.month, t.day) < (b.month, b.day))) >= 18
def _add(self, uid, delta, why, ref=None):
    w = self.wallets.setdefault(uid, {'balance': 0, 'daily': None})
    if w['balance'] + delta < 0: raise PermissionError('no_points')
    w['balance'] += delta; self.ledger_rows.append({'user': uid, 'delta': delta, 'reason': why, 'ref': ref, 'created_at': _dt.datetime.now().isoformat()})
    return w['balance']
Fake._need = _need; Fake._adult = _adult; Fake._add = _add

def _wrap(fn):
    def f(self, uid, *a):
        try:
            self._need(uid) if fn.__name__ not in ('f_getLive', 'f_liveChat', 'f_liveRanking', 'f_shopItems') else self._v7init()
            if not self.v7_enabled: return self.err('PGRST202', 'Could not find the function')
            return fn(self, uid, *a)
        except LookupError: return self.err('PGRST202', 'Could not find the function')
        except PermissionError as e: return self.err('P0001', str(e))
    f.__name__ = fn.__name__; return f

def _reg(fn): setattr(Fake, fn.__name__, _wrap(fn)); return fn

@_reg
def f_myAccount(self, uid):
    a = self.acct.get(uid, {}); p = self.profiles.get(uid, {})
    return self.ok({'name': p.get('name'), 'avatar': p.get('avatar'), 'prefs': p.get('prefs') or {}, 'cosmetics': p.get('cosmetics') or {},
                    'terms_version': a.get('version'), 'terms_accepted_at': a.get('at'), 'has_birth': bool(a.get('birth')), 'adult': self._adult(uid)})
@_reg
def f_acceptTerms(self, uid, version, birth):
    a = self.acct.setdefault(uid, {})
    if not a.get('birth'):
        if not birth: return self.err('P0001', 'bad_birth')
        b = _dt.date.fromisoformat(birth); t = _dt.date.today()
        if (t.year - b.year - ((t.month, t.day) < (b.month, b.day))) < 16: return self.err('P0001', 'too_young')
        a['birth'] = b
    a['version'] = version; a['at'] = _dt.datetime.now().isoformat(); return self.ok()
@_reg
def f_myWallet(self, uid):
    if uid not in self.wallets: self._add(uid, 1000, 'boas-vindas')
    w = self.wallets[uid]
    return self.ok({'balance': w['balance'], 'daily_available': w['daily'] != _dt.date.today(), 'items': list(self.items.get(uid, []))})
@_reg
def f_claimDaily(self, uid):
    self.f_myWallet(uid); w = self.wallets[uid]
    if w['daily'] == _dt.date.today(): return self.err('P0001', 'already_claimed')
    w['daily'] = _dt.date.today(); return self.ok(self._add(uid, 100, 'bonus-diario'))
@_reg
def f_shopItems(self, uid):
    return self.ok([{'id': i, 'kind': k, 'tier': t, 'title': ti, 'price': p, 'sort': n} for n, (i, k, t, ti, p) in enumerate(SHOP)])
@_reg
def f_ledger(self, uid):
    return self.ok([dict(r) for r in reversed(self.ledger_rows) if r['user'] == uid][:25])
@_reg
def f_buyItem(self, uid, item):
    it = next((x for x in SHOP if x[0] == item), None)
    if not it: return self.err('P0001', 'not_found')
    if item in self.items.get(uid, []): return self.err('P0001', 'owned')
    self.f_myWallet(uid); bal = self._add(uid, -it[4], 'lojinha', item)
    self.items.setdefault(uid, []).append(item); return self.ok(bal)
@_reg
def f_equipItem(self, uid, slot, item):
    p = self.profiles[uid]; c = dict(p.get('cosmetics') or {})
    if item:
        it = next((x for x in SHOP if x[0] == item), None)
        want = {'frame': 'frame', 'name': 'name'}.get(slot, 'fx')
        if not it or it[1] != want: return self.err('P0001', 'bad_item')
        if item not in self.items.get(uid, []): return self.err('P0001', 'not_owned')
        c[slot] = it[2] if slot in ('frame', 'name') else True
    else: c.pop(slot, None)
    p['cosmetics'] = c; return self.ok(c)
@_reg
def f_createLive(self, uid, row):
    if not all(self.is_member(t, uid) for t in row.get('turma_ids', [])): raise PermissionError('rls')
    code = ''.join(random.choice('0123456789ABCDEF') for _ in range(8))
    g = dict(row); g.update({'owner': uid, 'code': code, 'active': True, 'updated_at': _dt.datetime.now().isoformat()}); g.setdefault('palpites', True)
    self.lives[row['id']] = g; return self.ok({'id': row['id'], 'code': code})
@_reg
def f_updateLive(self, uid, lid, patch):
    g = self.lives.get(lid)
    if not g or g['owner'] != uid: return self.ok([])
    g.update(patch); g['updated_at'] = _dt.datetime.now().isoformat(); return self.ok([])
@_reg
def f_liveList(self, uid):
    rows = [g for g in self.lives.values() if g['active'] and (g['owner'] == uid or any(self.is_member(t, uid) for t in g.get('turma_ids', [])))]
    return self.ok([{'id': g['id'], 'code': g['code'], 'title': g.get('title'), 'owner': g['owner'], 'updated_at': g['updated_at']} for g in rows])
@_reg
def f_getLive(self, uid, code):
    g = next((g for g in self.lives.values() if g['code'] == str(code).upper()), None)
    if not g: return self.ok(None)
    return self.ok({'id': g['id'], 'title': g.get('title'), 'state': g.get('state') or {}, 'markets': g.get('markets') if g.get('palpites') and uid and self._adult(uid) else None,
                    'palpites': g.get('palpites'), 'active': g['active'], 'updated_at': g['updated_at'], 'is_owner': g['owner'] == uid})
@_reg
def f_placePalpite(self, uid, lid, market, stake):
    if not self._adult(uid): return self.err('P0001', 'adult_only')
    g = self.lives.get(lid)
    if not g or not g['active']: return self.err('P0001', 'no_game')
    if g['owner'] == uid: return self.err('P0001', 'own_game')
    mk = g.get('markets') or {}
    if not g.get('palpites') or not mk.get('open'): return self.err('P0001', 'closed')
    if not (10 <= stake <= 500): return self.err('P0001', 'bad_stake')
    it = next((i for i in mk.get('items', []) if i['key'] == market), None)
    if not it: return self.err('P0001', 'no_market')
    odd = min(20, max(1.05, round(float(it['odd']), 2)))
    if sum(1 for p in self.palps if p['user'] == uid and p['live'] == lid and p['match_no'] == mk['match_no']) >= 5: return self.err('P0001', 'limit')
    self.f_myWallet(uid); bal = self._add(uid, -stake, 'palpite')
    pid = len(self.palps) + 1
    self.palps.append({'id': pid, 'live': lid, 'match_no': mk['match_no'], 'user': uid, 'market': market, 'label': it['label'], 'odd': odd, 'stake': stake, 'status': 'open', 'payout': 0})
    return self.ok({'palpite_id': pid, 'balance': bal, 'odd': odd})
@_reg
def f_myPalpites(self, uid, lid):
    return self.ok([{k: p[k] for k in ('id', 'match_no', 'market', 'label', 'odd', 'stake', 'status', 'payout')} for p in reversed(self.palps) if p['user'] == uid and p['live'] == lid])
@_reg
def f_settlePalpites(self, uid, lid, match_no, result):
    g = self.lives.get(lid)
    if not g or g['owner'] != uid: return self.err('P0001', 'only_owner')
    n = 0
    for p in self.palps:
        if p['live'] != lid or p['match_no'] != match_no or p['status'] != 'open': continue
        n += 1
        if result.get('void'):
            p['status'] = 'void'; p['payout'] = p['stake']; self._add(p['user'], p['stake'], 'palpite-devolvido'); continue
        m = p['market']; ga, gb = result.get('goalsA', 0), result.get('goalsB', 0)
        won = (m == 'res:A' and result.get('winner') == 'A') or (m == 'res:B' and result.get('winner') == 'B') or (m == 'res:draw' and result.get('winner') == 'draw') \
            or (m.startswith('gol:') and m[4:] in result.get('scorers', [])) or (m.startswith('over:') and ga + gb > float(m[5:])) or (m == 'ambos' and ga > 0 and gb > 0)
        if won: p['status'] = 'won'; p['payout'] = _math.floor(p['stake'] * p['odd']); self._add(p['user'], p['payout'], 'palpite-certo')
        else: p['status'] = 'lost'
    return self.ok(n)
@_reg
def f_liveRanking(self, uid, lid):
    tot = {}
    for p in self.palps:
        if p['live'] != lid or p['status'] == 'open': continue
        t = tot.setdefault(p['user'], [0, 0]); t[0] += p['payout'] - p['stake']; t[1] += p['status'] == 'won'
    rows = [{'name': self.profiles[u]['name'], 'avatar': self.profiles[u].get('avatar'), 'cosmetics': self.profiles[u].get('cosmetics') or {}, 'net': v[0], 'hits': v[1]} for u, v in tot.items()]
    return self.ok(sorted(rows, key=lambda r: -r['net']))
def _can_room(self, uid, room):
    kind, rid = room.split(':', 1)
    return self.is_member(rid, uid) if kind == 'turma' else rid in self.lives
Fake._can_room = _can_room
@_reg
def f_chatList(self, uid, room, after):
    if not self._can_room(uid, room): return self.ok([])
    rows = [dict(m) for m in self.chat if m['room'] == room and m['id'] > (after or 0)]
    return self.ok([{k: m[k] for k in ('id', 'user_id', 'body', 'deleted', 'created_at')} for m in reversed(rows)][:60])
@_reg
def f_chatSend(self, uid, room, body):
    if not self._can_room(uid, room) or not self.acct.get(uid, {}).get('at'): raise PermissionError('new row violates row-level security')
    if not (1 <= len(body) <= 500): return self.err('23514', 'check')
    now = _dt.datetime.now()
    if sum(1 for m in self.chat if m['user_id'] == uid and (now - _dt.datetime.fromisoformat(m['created_at'])).total_seconds() < 10) >= 5: return self.err('P0001', 'slow_down')
    self.chat.append({'id': len(self.chat) + 1, 'room': room, 'user_id': uid, 'body': body, 'deleted': False, 'created_at': now.isoformat()}); return self.ok([])
@_reg
def f_chatDelete(self, uid, mid):
    m = next((m for m in self.chat if m['id'] == mid), None)
    if not m: return self.err('P0001', 'not_found')
    kind, rid = m['room'].split(':', 1)
    if not (m['user_id'] == uid or (kind == 'turma' and self.is_admin(rid, uid)) or (kind == 'live' and self.lives.get(rid, {}).get('owner') == uid)): return self.err('P0001', 'not_allowed')
    m['deleted'] = True; m['body'] = '-'; return self.ok()
@_reg
def f_chatReport(self, uid, mid, why):
    self.reports.add((mid, uid))
    if sum(1 for r in self.reports if r[0] == mid) >= 3:
        for m in self.chat:
            if m['id'] == mid: m['deleted'] = True
    return self.ok()
@_reg
def f_liveChat(self, uid, code, after):
    g = next((g for g in self.lives.values() if g['code'] == str(code).upper()), None)
    if not g: return self.ok([])
    rows = [m for m in self.chat if m['room'] == 'live:' + g['id'] and m['id'] > (after or 0)]
    out = []
    for m in reversed(rows[-60:]):
        p = self.profiles.get(m['user_id'], {})
        out.append({'id': m['id'], 'user_id': m['user_id'], 'name': p.get('name', 'Conta excluída'), 'avatar': p.get('avatar'), 'cosmetics': p.get('cosmetics') or {},
                    'body': '' if m['deleted'] else m['body'], 'deleted': m['deleted'], 'created_at': m['created_at']})
    return self.ok(out)
@_reg
def f_peopleCards(self, uid, ids):
    return self.ok([{'id': i, 'name': self.profiles[i]['name'], 'avatar': self.profiles[i].get('avatar'), 'cosmetics': self.profiles[i].get('cosmetics') or {}} for i in ids if i in self.profiles])

# ---- v8: support status (staff, suspension, notice) and daily activity
def _v8init(self):
    if not hasattr(self, 'staff'):
        self.staff = set(); self.bans = {}; self.notice = None; self.pings = []; self.v8_enabled = True
Fake._v8init = _v8init
@_reg
def f_myStatus(self, uid):
    self._v8init()
    if not self.v8_enabled: return self.err('PGRST202', 'Could not find the function')
    b = self.bans.get(uid)
    n = self.notice or {}
    return self.ok({'staff': uid in self.staff, 'banned_until': b['until'] if b else None, 'banned_reason': b['reason'] if b else None,
                    'notice': n.get('message'), 'notice_level': n.get('level')})
@_reg
def f_pingActivity(self, uid):
    self._v8init()
    if not self.v8_enabled: return self.err('PGRST202', 'Could not find the function')
    self.pings.append(uid); return self.ok(None)

# ---- v9: exclusive items and weekly missions
EXCL = {'frame_teal_orange': ('frame', 'tealorange', 'Moldura Teal & Orange Metálico', 'dono', 17),
        'name_teal_orange': ('name', 'tealorange', 'Nome Teal & Orange Metálico', 'dono', 27),
        'fx_frame_fogo_azul': ('fx', 'fogo-azul', 'Brilho Moldura · Aura de Fogo Azul', 'fundador', 32),
        'fx_name_fogo_azul': ('fx', 'fogo-azul', 'Brilho Nome · Aura de Fogo Azul', 'fundador', 33)}
OWNER_EMAILS = {'gabrieljastim13@gmail.com', 'contatobabaapp@gmail.com'}
MISSIONS = [('presenca', 'Presença garantida', 'Abra o BABA em 3 dias diferentes da semana', 'days_active', 3, 100, False),
            ('bonus', 'Bônus em dia', 'Pegue o bônus do dia 4 vezes na semana', 'daily_bonus', 4, 100, False),
            ('jogar', 'Bola rolando', 'Jogue 1 baba (com seu nome ligado à conta na turma)', 'babas_played', 1, 150, False),
            ('organizar', 'Organizador da semana', 'Finalize 1 baba que você organizou', 'babas_organized', 1, 200, False),
            ('artilheiro', 'Faro de gol', 'Marque 3 gols nos babas da semana', 'goals', 3, 200, False),
            ('resenha', 'Resenha em dia', 'Mande 3 mensagens no chat da turma ou do jogo', 'chat', 3, 50, False),
            ('palpiteiro', 'Palpiteiro', 'Faça 3 palpites em jogos ao vivo', 'palpites', 3, 80, True)]
def _v9init(self):
    if not hasattr(self, 'founders'):
        self.founders = None; self.mprog = {}; self.mclaims = set(); self.v9_enabled = True
Fake._v9init = _v9init
def _shop_all():
    rows = [{'id': i, 'kind': k, 'tier': t, 'title': ti, 'price': p, 'sort': n, 'exclusive': None} for n, (i, k, t, ti, p) in enumerate(SHOP)]
    rows += [{'id': i, 'kind': v[0], 'tier': v[1], 'title': v[2], 'price': 0, 'sort': v[4], 'exclusive': v[3]} for i, v in EXCL.items()]
    return sorted(rows, key=lambda r: r['sort'])
@_reg
def f_shopItems(self, uid):
    self._v9init(); return self.ok(_shop_all() if self.v9_enabled else [r for r in _shop_all() if not r['exclusive']])
@_reg
def f_myWallet(self, uid):
    self._v9init()
    if uid not in self.wallets: self._add(uid, 1000, 'boas-vindas')
    if self.v9_enabled:
        mine = self.items.setdefault(uid, [])
        is_founder = self.founders is None or uid in self.founders
        is_owner = self.email_of(uid).lower() in OWNER_EMAILS
        for i, v in EXCL.items():
            if ((v[3] == 'fundador' and is_founder) or (v[3] == 'dono' and is_owner)) and i not in mine: mine.append(i)
    w = self.wallets[uid]
    return self.ok({'balance': w['balance'], 'daily_available': w['daily'] != _dt.date.today(), 'items': list(self.items.get(uid, []))})
@_reg
def f_buyItem(self, uid, item):
    if item in EXCL: return self.err('P0001', 'exclusive')
    it = next((x for x in SHOP if x[0] == item), None)
    if not it: return self.err('P0001', 'not_found')
    if item in self.items.get(uid, []): return self.err('P0001', 'owned')
    self.f_myWallet(uid); bal = self._add(uid, -it[4], 'lojinha', item)
    self.items.setdefault(uid, []).append(item); return self.ok(bal)
@_reg
def f_equipItem(self, uid, slot, item):
    p = self.profiles[uid]; c = dict(p.get('cosmetics') or {})
    if item:
        it = next(({'kind': x[1], 'tier': x[2]} for x in SHOP if x[0] == item), None) or ({'kind': EXCL[item][0], 'tier': EXCL[item][1]} if item in EXCL else None)
        want = {'frame': 'frame', 'name': 'name'}.get(slot, 'fx')
        if not it or it['kind'] != want: return self.err('P0001', 'bad_item')
        if slot == 'frameShine' and not item.startswith('fx_frame_'): return self.err('P0001', 'bad_item')
        if slot == 'nameShine' and not item.startswith('fx_name_'): return self.err('P0001', 'bad_item')
        if item not in self.items.get(uid, []): return self.err('P0001', 'not_owned')
        c[slot] = it['tier'] if slot in ('frame', 'name') else (it['tier'] or True)
    else: c.pop(slot, None)
    p['cosmetics'] = c; return self.ok(c)
@_reg
def f_myMissions(self, uid):
    self._v9init()
    if not self.v9_enabled: return self.err('PGRST202', 'Could not find the function')
    ws = _dt.date.today() - _dt.timedelta(days=_dt.date.today().weekday())
    prog = self.mprog.get(uid, {}); adult = self._adult(uid)
    return self.ok([{'id': i, 'title': t, 'description': d, 'target': tg, 'reward': r, 'progress': min(prog.get(mt, 0), tg),
                     'claimed': (uid, i) in self.mclaims, 'week_start': ws.isoformat(), 'week_end': (ws + _dt.timedelta(days=6)).isoformat()}
                    for i, t, d, mt, tg, r, ao in MISSIONS if adult or not ao])
@_reg
def f_claimMission(self, uid, mission):
    self._v9init()
    m = next((x for x in MISSIONS if x[0] == mission), None)
    if not m: return self.err('P0001', 'not_found')
    if self.mprog.get(uid, {}).get(m[3], 0) < m[4]: return self.err('P0001', 'not_done')
    if (uid, mission) in self.mclaims: return self.err('P0001', 'already_claimed')
    self.mclaims.add((uid, mission)); self.f_myWallet(uid)
    return self.ok(self._add(uid, m[5], 'missao', mission + ':week'))

# ---- v9.5: jogadoras
def f_setFemale(self, uid, pid, v):
    p = self.players[pid]
    if not self.is_admin(p['turma_id'], uid): raise PermissionError('admin')
    if not getattr(self, 'female_col', True): return self.err('42703', 'column is_female does not exist')
    p['is_female'] = v; return self.ok([])
Fake.f_setFemale = f_setFemale

# ---- v10: babas in progress in my turmas
def f_turmaOpenBabas(self, uid):
    rows = [b for b in self.babas.values() if not b['finished'] and self.can_see(b, uid)]
    rows.sort(key=lambda b: b['updated'], reverse=True)
    return self.ok([{'id': b['id'], 'title': b.get('title'), 'created_by': b['created_by'], 'state': b.get('state'), 'updated_at': '2099-01-01T00:00:00Z'} for b in rows[:20]])
Fake.f_turmaOpenBabas = f_turmaOpenBabas

# ---- v10: Desafio 1v1
def _ch(self):
    self._v7init()
    if not hasattr(self, 'chals'): self.chals = []; self.v10_enabled = True
    if not self.v10_enabled: raise LookupError()
def _can_ch(self, u):
    return bool(u) and self._adult(u) and bool(self.acct.get(u, {}).get('at')) and u not in getattr(self, 'bans', {})
def _open_for(self, lid):
    g = self.lives.get(lid); mk = (g or {}).get('markets') or {}
    if not g or not g['active'] or not g.get('palpites') or not mk.get('open'): return None
    return mk.get('match_no')
Fake._ch = _ch; Fake._can_ch = _can_ch; Fake._open_for = _open_for
def _chk(fn):
    def g(self, uid, *a):
        self._ch(); return fn(self, uid, *a)
    g.__name__ = fn.__name__; setattr(Fake, fn.__name__, _wrap(g)); return fn
@_chk
def f_challengeCandidates(self, uid, lid):
    g = self.lives.get(lid)
    if not g: return self.err('P0001', 'no_game')
    room = 'live:' + lid
    ids = {m['user_id'] for m in self.chat if m['room'] == room} | {p['user'] for p in self.palps if p['live'] == lid}
    if any(self.is_member(t, uid) for t in g.get('turma_ids', [])):
        ids |= {u for t in g.get('turma_ids', []) for u in self.profiles if self.is_member(t, u)}
    ids = [u for u in ids if u and u != uid and u != g['owner'] and self._can_ch(u)]
    return self.ok(sorted([{'id': u, 'name': self.profiles[u]['name'], 'avatar': self.profiles[u].get('avatar'), 'cosmetics': self.profiles[u].get('cosmetics') or {}} for u in ids], key=lambda r: r['name']))
@_chk
def f_createChallenge(self, uid, lid, opp, kind, pc, po, lc, lo, stake):
    if not self._can_ch(uid): return self.err('P0001', 'adult_only')
    mno = self._open_for(lid)
    if mno is None: return self.err('P0001', 'closed')
    g = self.lives[lid]
    if uid in (g['owner'],) or opp == g['owner']: return self.err('P0001', 'own_game')
    if opp == uid: return self.err('P0001', 'self')
    if not self._can_ch(opp): return self.err('P0001', 'opponent_not_allowed')
    if kind == 'vencedor':
        pc, po = pc.upper(), po.upper()
        if {pc, po} != {'A', 'B'}: return self.err('P0001', 'bad_pick')
    else:
        names = {n.strip().lower()[:60] for t in ('A', 'B') for n in ((g.get('state') or {}).get(t) or {}).get('names', [])}
        pc, po = pc.strip().lower()[:60], po.strip().lower()[:60]
        if pc not in names or po not in names or pc == po: return self.err('P0001', 'bad_pick')
    if not (10 <= stake <= 500): return self.err('P0001', 'bad_stake')
    if sum(1 for c in self.chals if c['c'] == uid and c['live'] == lid and c['match_no'] == mno and c['status'] in ('pending', 'accepted')) >= 3: return self.err('P0001', 'limit')
    self.f_myWallet(uid); self._add(uid, -stake, 'desafio')
    cid = len(self.chals) + 1
    self.chals.append({'id': cid, 'live': lid, 'match_no': mno, 'kind': kind, 'c': uid, 'o': opp, 'stake': stake, 'pc': pc, 'po': po, 'lc': lc[:80], 'lo': lo[:80], 'status': 'pending', 'created_at': _dt.datetime.now().isoformat()})
    return self.ok(cid)
@_chk
def f_respondChallenge(self, uid, cid, accept):
    c = next((x for x in self.chals if x['id'] == cid), None)
    if not c or c['o'] != uid: return self.err('P0001', 'not_found')
    if c['status'] != 'pending': return self.err('P0001', 'already')
    if not accept:
        c['status'] = 'declined'; self._add(c['c'], c['stake'], 'desafio-devolvido'); return self.ok('declined')
    if self._open_for(c['live']) != c['match_no']: return self.err('P0001', 'closed')
    self.f_myWallet(uid); self._add(uid, -c['stake'], 'desafio'); c['status'] = 'accepted'; return self.ok('accepted')
@_chk
def f_cancelChallenge(self, uid, cid):
    c = next((x for x in self.chals if x['id'] == cid), None)
    if not c or c['c'] != uid: return self.err('P0001', 'not_found')
    if c['status'] != 'pending': return self.err('P0001', 'already')
    c['status'] = 'canceled'; self._add(uid, c['stake'], 'desafio-devolvido'); return self.ok(None)
@_chk
def f_myChallenges(self, uid, lid):
    out = []
    for c in reversed(self.chals):
        if c['live'] != lid or uid not in (c['c'], c['o']): continue
        me = c['c'] == uid; other = c['o'] if me else c['c']
        out.append({'id': c['id'], 'match_no': c['match_no'], 'kind': c['kind'], 'stake': c['stake'], 'status': c['status'], 'mine_is_challenger': me,
                    'other_id': other, 'other_name': self.profiles.get(other, {}).get('name', 'Conta excluída'),
                    'my_label': c['lc'] if me else c['lo'], 'their_label': c['lo'] if me else c['lc'], 'created_at': c['created_at']})
    return self.ok(out[:30])
def _settle_ch(self, lid, mno, result):
    if not hasattr(self, 'chals'): return
    for c in self.chals:
        if c['live'] != lid or c['match_no'] != mno or c['status'] not in ('pending', 'accepted'): continue
        if c['status'] == 'pending' or result.get('void'):
            if c['status'] == 'accepted': self._add(c['o'], c['stake'], 'desafio-devolvido')
            c['status'] = 'void'; self._add(c['c'], c['stake'], 'desafio-devolvido'); continue
        if c['kind'] == 'vencedor':
            w = 'c' if result.get('winner') == c['pc'] else 'o' if result.get('winner') == c['po'] else 'push'
        else:
            gb = result.get('goalsBy') or {}; sc = result.get('scorers') or []
            a = gb.get(c['pc'], 1 if c['pc'] in sc else 0); b = gb.get(c['po'], 1 if c['po'] in sc else 0)
            w = 'c' if a > b else 'o' if b > a else 'push'
        if w == 'push': c['status'] = 'push'; self._add(c['c'], c['stake'], 'desafio-devolvido'); self._add(c['o'], c['stake'], 'desafio-devolvido')
        else: c['status'] = 'won_' + w; self._add(c[w], c['stake'] * 2, 'desafio-ganho')
Fake._settle_ch = _settle_ch
_old_settle = Fake.f_settlePalpites
def f_settlePalpites(self, uid, lid, match_no, result):
    r = _old_settle(self, uid, lid, match_no, result)
    if 'err' not in r:
        self.last_result = result; self._settle_ch(lid, match_no, result)
    return r
Fake.f_settlePalpites = f_settlePalpites


# ---- v10.1: lojinha nova, pipoca, push
SHOP.extend([
    ('title_fominha', 'title', 'fominha', 'Título · Fominha', 300),
    ('title_resenha', 'title', 'resenha', 'Título · Rei da Resenha', 300),
    ('title_perna', 'title', 'perna', 'Título · Perna de Pau', 200),
    ('title_matador', 'title', 'matador', 'Título · Matador', 400),
    ('title_camisa10', 'title', 'camisa10', 'Título · Camisa 10', 400),
    ('title_paredao', 'title', 'paredao', 'Título · Paredão', 400),
    ('title_garcom', 'title', 'garcom', 'Título · Garçom', 400),
    ('title_xerife', 'title', 'xerife', 'Título · Xerife da Zaga', 400),
    ('title_rei', 'title', 'rei', 'Título · Rei da Quadra', 800),
    ('title_lenda', 'title', 'lenda', 'Título · Lenda do Baba', 1500),
    ('nick_codinome', 'nick', None, 'Codinome', 500),
    ('mascot_wink', 'mascot', 'wink', 'Babinha Piscadinha', 500),
    ('mascot_coach', 'mascot', 'coach', 'Babinha Professor', 600),
    ('mascot_dancinha', 'mascot', 'dancinha', 'Babinha Dancinha', 600),
    ('mascot_arrogante', 'mascot', 'arrogante', 'Babinha Marrento', 700),
    ('mascot_carretilha', 'mascot', 'carretilha', 'Babinha Carretilha', 900),
    ('mascot_siuu', 'mascot', 'siuu', 'Babinha Comemoração', 900),
    ('mascot_champion', 'mascot', 'champion', 'Babinha Campeão', 1200),
    ('mascot_aura', 'mascot', 'aura', 'Babinha Aura', 1500),
    ('goalcard_fogo', 'goalcard', 'fogo', 'Anúncio de gol · Fogo', 800),
    ('goalcard_raio', 'goalcard', 'raio', 'Anúncio de gol · Raio', 800),
    ('goalcard_retro', 'goalcard', 'retro', 'Anúncio de gol · Fliperama', 1000),
    ('goalcard_neon', 'goalcard', 'neon', 'Anúncio de gol · Neon', 1000),
    ('goalcard_ouro', 'goalcard', 'ouro', 'Anúncio de gol · Ouro', 1500),
    ('goalcard_galaxia', 'goalcard', 'galaxia', 'Anúncio de gol · Galáxia', 2000),
    ('cardbg_gramado', 'cardbg', 'gramado', 'Card · Gramado', 500),
    ('cardbg_noite', 'cardbg', 'noite', 'Card · Jogo à Noite', 700),
    ('cardbg_por-do-sol', 'cardbg', 'por-do-sol', 'Card · Pôr do Sol', 800),
    ('cardbg_retro', 'cardbg', 'retro', 'Card · Álbum Antigo', 900),
    ('cardbg_ouro', 'cardbg', 'ouro', 'Card · Ouro', 1800),
    ('cardbg_holo', 'cardbg', 'holo', 'Card · Holográfico', 2500),
    ('goalsound_corneta', 'goalsound', 'corneta', 'Som de gol · Corneta', 500),
    ('goalsound_sirene', 'goalsound', 'sirene', 'Som de gol · Sirene', 500),
    ('goalsound_tambor', 'goalsound', 'tambor', 'Som de gol · Batucada', 600),
    ('goalsound_torcida', 'goalsound', 'torcida', 'Som de gol · Torcida', 600),
    ('goalsound_arcade', 'goalsound', 'arcade', 'Som de gol · Fliperama', 700)])
_SLOT_KIND = {'frame': 'frame', 'name': 'name', 'frameShine': 'fx', 'nameShine': 'fx', 'title': 'title', 'mascot': 'mascot', 'goalCard': 'goalcard', 'cardBg': 'cardbg', 'goalSound': 'goalsound'}
@_reg
def f_equipItem(self, uid, slot, item):
    p = self.profiles[uid]; c = dict(p.get('cosmetics') or {})
    want = _SLOT_KIND.get(slot)
    if not want: return self.err('P0001', 'bad_slot')
    if item:
        it = next(({'kind': x[1], 'tier': x[2]} for x in SHOP if x[0] == item), None) or ({'kind': EXCL[item][0], 'tier': EXCL[item][1]} if item in EXCL else None)
        if not it or it['kind'] != want: return self.err('P0001', 'bad_item')
        if slot == 'frameShine' and not item.startswith('fx_frame_'): return self.err('P0001', 'bad_item')
        if slot == 'nameShine' and not item.startswith('fx_name_'): return self.err('P0001', 'bad_item')
        if item not in self.items.get(uid, []): return self.err('P0001', 'not_owned')
        c[slot] = (it['tier'] or True) if want == 'fx' else it['tier']
    else: c.pop(slot, None)
    p['cosmetics'] = c; return self.ok(c)
BAD = ['porra', 'caralh', 'puta', 'merda', 'viad']
@_reg
def f_setNickname(self, uid, nick):
    if 'nick_codinome' not in self.items.get(uid, []): return self.err('P0001', 'not_owned')
    v = ' '.join(str(nick or '').split()); p = self.profiles[uid]; c = dict(p.get('cosmetics') or {})
    if not v: c.pop('nick', None)
    else:
        if not (2 <= len(v) <= 20): return self.err('P0001', 'bad_length')
        if any(w in v.lower() for w in BAD): return self.err('P0001', 'bad_word')
        c['nick'] = v
    p['cosmetics'] = c; return self.ok(c)
@_reg
def f_throwPipoca(self, uid, target):
    if target == uid: return self.err('P0001', 'self')
    if not any((t, target) in self.members for (t, u) in self.members if u == uid): return self.err('P0001', 'not_friends')
    pc = (self.profiles.get(target, {}).get('cosmetics') or {}).get('pipoca')
    if pc and pc['until'] > _dt.datetime.utcnow().isoformat(): return self.err('P0001', 'already')
    self.f_myWallet(uid); bal = self._add(uid, -150, 'pipoca', target)
    c = dict(self.profiles[target].get('cosmetics') or {})
    c['pipoca'] = {'until': (_dt.datetime.utcnow() + _dt.timedelta(hours=24)).isoformat() + 'Z', 'from': self.profiles[uid]['name']}
    self.profiles[target]['cosmetics'] = c
    return self.ok(bal)
def _pushinit(self):
    if not hasattr(self, 'subs'): self.subs = {}; self.follows = set(); self.pushes = []
Fake._pushinit = _pushinit
def f_savePush(self, uid, ep, p256dh, auth, live_code, turma):
    self._pushinit(); s = self.subs.setdefault(ep, {'user': uid, 'turma': False})
    if uid: s['user'] = uid
    if turma is not None: s['turma'] = bool(turma) and bool(uid)
    if live_code:
        g = next((g for g in self.lives.values() if g['code'] == live_code.upper() and g['active']), None) if hasattr(self, 'lives') else None
        if not g: return self.err('P0001', 'no_game')
        self.follows.add((ep, g['id']))
    return self.ok('ok')
def f_dropPush(self, uid, ep, live_code, turma):
    self._pushinit()
    if live_code: self.follows = {f for f in self.follows if not (f[0] == ep and self.lives.get(f[1], {}).get('code') == live_code.upper())}
    elif turma is not None and ep in self.subs: self.subs[ep]['turma'] = bool(turma)
    else: self.subs.pop(ep, None)
    return self.ok(None)
def f_pushStatus(self, uid, ep, live_code):
    self._pushinit(); s = self.subs.get(ep)
    fol = any(f[0] == ep and self.lives.get(f[1], {}).get('code') == str(live_code or '').upper() for f in self.follows)
    return self.ok({'known': bool(s), 'turma_on': bool(s and s['turma']), 'following': fol})
def f_livePush(self, uid, live_id, code, kind, key, title, body):
    self._pushinit()
    g = self.lives.get(live_id)
    if not g or g['owner'] != uid: return self.ok({'sent': 0, 'reason': 'only_owner'})
    if any(p['key'] == key and p['live'] == live_id for p in self.pushes): return self.ok({'sent': 0, 'reason': 'dup'})
    self.pushes.append({'live': live_id, 'kind': kind, 'key': key, 'title': title, 'body': body})
    return self.ok({'sent': 1})
Fake.f_savePush = f_savePush; Fake.f_dropPush = f_dropPush; Fake.f_pushStatus = f_pushStatus; Fake.f_livePush = f_livePush
