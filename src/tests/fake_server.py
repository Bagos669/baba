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
                         'venue': (b.get('state') or {}).get('venue'), 'baba_stats': [dict(s) for s in self.stats.get(b['id'], [])]} for b in rows])
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

# ---- v11: compromisso
LEVELS = ['ok', 'aviso', 'prioridade', 'bloqueio', 'banimento']
def _evinit(self):
    if not hasattr(self, 'events'):
        self.events = {}; self.rsvps = {}; self.rules = {}; self.sanctions = []; self.tbans = {}; self.v11_enabled = True
    if not self.v11_enabled: raise LookupError()
Fake._evinit = _evinit
def _is_adm(self, t, u): return self.members.get((t, u)) == 'admin' or (self.turmas.get(t) or {}).get('owner_id') == u
def _level(self, t, key):
    r = self.rules.get(t, {'mode': 'auto', 'aviso': 1, 'prioridade': 2, 'bloqueio': 3, 'banimento': 4, 'janela_dias': 60})
    lv = 0
    if r['mode'] == 'auto':
        misses = sum(1 for (eid, k), v in self.rsvps.items() if k == key and v.get('outcome') == 'miou' and self.events[eid]['turma_id'] == t)
        lv = 4 if misses >= r['banimento'] else 3 if misses >= r['bloqueio'] else 2 if misses >= r['prioridade'] else 1 if misses >= r['aviso'] else 0
    if r['mode'] != 'off':
        for s in self.sanctions:
            if s['turma_id'] == t and s['player_key'] == key and not s.get('cleared'): lv = max(lv, LEVELS.index(s['kind']))
    return LEVELS[lv]
Fake._is_adm = _is_adm; Fake._level = _level
def _evreg(fn):
    def g(self, uid, *a):
        self._evinit(); return fn(self, uid, *a)
    g.__name__ = fn.__name__; setattr(Fake, fn.__name__, _wrap(g)); return fn
def _evrow(self, e):
    return dict(e, event_rsvps=[dict(v) for (eid, k), v in self.rsvps.items() if eid == e['id']])
@_evreg
def f_events(self, uid, ids):
    return self.ok([self._evrow(e) for e in sorted(self.events.values(), key=lambda e: e['starts_at']) if e['turma_id'] in ids and self.is_member(e['turma_id'], uid)])
Fake._evrow = _evrow
@_evreg
def f_createEvent(self, uid, t, starts, place, note, mx):
    if not self._is_adm(t, uid): return self.err('P0001', 'not_allowed')
    eid = str(uuid.uuid4())
    self.events[eid] = {'id': eid, 'turma_id': t, 'created_by': uid, 'starts_at': starts, 'place': place or None, 'note': note or None, 'max_players': mx, 'status': 'open', 'created_at': _dt.datetime.utcnow().isoformat(), 'closed_at': None}
    self.chat.append({'id': len(self.chat) + 1, 'room': 'turma:' + t, 'user_id': uid, 'body': ':ev:' + eid + ':', 'deleted': False, 'created_at': _dt.datetime.now().isoformat()})
    return self.ok(eid)
@_evreg
def f_updateEvent(self, uid, eid, starts, place, note, mx, status):
    e = self.events.get(eid)
    if not e or not self._is_adm(e['turma_id'], uid): return self.err('P0001', 'not_allowed')
    if starts: e['starts_at'] = starts
    if place is not None: e['place'] = place or None
    if note is not None: e['note'] = note or None
    if mx == 0: e['max_players'] = None
    elif mx: e['max_players'] = mx
    if status: e['status'] = status
    return self.ok(None)
@_evreg
def f_rsvpEvent(self, uid, eid, answer, player, name, inviter=None):
    e = self.events.get(eid)
    if not e or not self.is_member(e['turma_id'], uid): return self.err('P0001', 'not_found')
    if e['status'] != 'open': return self.err('P0001', 'closed')
    adm = self._is_adm(e['turma_id'], uid)
    p = None
    if player is None and name is None:
        p = next((x for x in self.players.values() if x['turma_id'] == e['turma_id'] and x.get('user_id') == uid), None)
        if not p: return self.err('P0001', 'no_player')
    elif not adm: return self.err('P0001', 'not_allowed')
    elif player: p = self.players.get(player)
    nm = p['name'] if p else name
    key = nm.strip().lower()
    if answer == 'tirar': self.rsvps.pop((eid, key), None); return self.ok('tirar')
    if answer == 'vou' and not adm and self._level(e['turma_id'], key) in ('bloqueio', 'banimento'): return self.err('P0001', 'blocked')
    old = self.rsvps.get((eid, key))
    self.rsvps[(eid, key)] = {'player_key': key, 'name': nm, 'turma_player_id': p['id'] if p else None, 'user_id': p.get('user_id') if p else None, 'status': answer,
                              'source': 'adm' if adm and (not p or p.get('user_id') != uid) else 'app', 'outcome': old.get('outcome') if old else None,
                              'invited_by': (inviter or None) if not p else None,
                              'created_at': old['created_at'] if old else _dt.datetime.utcnow().isoformat()}
    return self.ok(answer)
@_evreg
def f_importRsvps(self, uid, eid, rows):
    e = self.events.get(eid)
    if not e or not self._is_adm(e['turma_id'], uid): return self.err('P0001', 'not_allowed')
    n = 0
    for r in rows:
        p = self.players.get(r.get('player_id')) if r.get('player_id') else None
        nm = p['name'] if p else (r.get('name') or '').strip()
        if not nm: continue
        key = nm.lower(); old = self.rsvps.get((eid, key))
        self.rsvps[(eid, key)] = {'player_key': key, 'name': nm, 'turma_player_id': p['id'] if p else None, 'user_id': p.get('user_id') if p else None,
                                  'invited_by': (r.get('invited_by') or None) if not p else None,
                                  'status': r.get('status') or 'vou', 'source': 'colado', 'outcome': None, 'created_at': old['created_at'] if old else _dt.datetime.utcnow().isoformat() + str(n).zfill(3)}
        n += 1
    return self.ok(n)
@_evreg
def f_relinkMyStats(self, uid):
    return self.ok(0)
@_evreg
def f_closeEvent(self, uid, eid, outcomes):
    e = self.events.get(eid)
    if not e or not self._is_adm(e['turma_id'], uid): return self.err('P0001', 'not_allowed')
    keys = [k for (x, k) in self.rsvps if x == eid]
    before = {k: self._level(e['turma_id'], k) for k in keys}
    for o in outcomes:
        r = self.rsvps.get((eid, o['key'].strip().lower()))
        if r: r['outcome'] = o.get('outcome')
    e['status'] = 'done'
    out = []
    for k in keys:
        lv = self._level(e['turma_id'], k)
        if LEVELS.index(lv) > LEVELS.index(before[k]): out.append({'player_key': k, 'name': self.rsvps[(eid, k)]['name'], 'before_level': before[k], 'level': lv})
    return self.ok(out)
@_evreg
def f_discipline(self, uid, t):
    if not self.is_member(t, uid): return self.err('P0001', 'not_member')
    adm = self._is_adm(t, uid)
    keys = {p['name'].strip().lower(): p['name'] for p in self.players.values() if p['turma_id'] == t}
    for (eid, k), v in self.rsvps.items():
        if self.events[eid]['turma_id'] == t: keys.setdefault(k, v['name'])
    rows = []
    for k, n in keys.items():
        cnt = lambda o: sum(1 for (eid, kk), v in self.rsvps.items() if kk == k and v.get('outcome') == o and self.events[eid]['turma_id'] == t)
        rows.append({'player_key': k, 'name': n, 'level': self._level(t, k), 'misses': cnt('miou') if adm else None, 'kept': cnt('cumpriu') if adm else None,
                     'justified': cnt('justificado') if adm else None,
                     'sanctions': [{'id': s['id'], 'kind': s['kind'], 'reason': s['reason'], 'until': None} for s in self.sanctions if s['turma_id'] == t and s['player_key'] == k and not s.get('cleared')] if adm else None})
    return self.ok(rows)
@_evreg
def f_turmaRules(self, uid, t):
    return self.ok(self.rules.get(t))
@_evreg
def f_setRules(self, uid, t, mode, aviso, prioridade, bloqueio, banimento, janela):
    if not self._is_adm(t, uid): return self.err('P0001', 'not_allowed')
    self.rules[t] = {'mode': mode, 'aviso': aviso, 'prioridade': prioridade, 'bloqueio': bloqueio, 'banimento': banimento, 'janela_dias': janela}; return self.ok(None)
@_evreg
def f_addSanction(self, uid, t, key, name, kind, reason, days):
    if not self._is_adm(t, uid): return self.err('P0001', 'not_allowed')
    self.sanctions.append({'id': len(self.sanctions) + 1, 'turma_id': t, 'player_key': key.lower(), 'name': name, 'kind': kind, 'reason': reason}); return self.ok(len(self.sanctions))
@_evreg
def f_clearSanction(self, uid, sid):
    s = next((x for x in self.sanctions if x['id'] == sid), None)
    if s: s['cleared'] = True
    return self.ok(None)
@_evreg
def f_banPlayer(self, uid, t, key, reason):
    if not self._is_adm(t, uid): return self.err('P0001', 'not_allowed')
    self.sanctions.append({'id': len(self.sanctions) + 1, 'turma_id': t, 'player_key': key, 'name': key, 'kind': 'banimento', 'reason': reason})
    p = next((x for x in self.players.values() if x['turma_id'] == t and x['name'].strip().lower() == key), None)
    if p and p.get('user_id'):
        self.tbans[(t, p['user_id'])] = True; self.members.pop((t, p['user_id']), None); p['user_id'] = None; return self.ok('banned_account')
    return self.ok('banned_name')
@_evreg
def f_unbanPlayer(self, uid, t, key): return self.ok(None)
def f_livePush2(self, uid, live_id, code, kind, key, title, body, event_id=None):
    if event_id:
        self._pushinit(); self._evinit()
        e = self.events.get(event_id)
        if not e or not self._is_adm(e['turma_id'], uid): return self.ok({'sent': 0, 'reason': 'not_allowed'})
        self.pushes.append({'event': event_id, 'kind': kind, 'key': key, 'title': title, 'body': body}); return self.ok({'sent': 1})
    return f_livePush(self, uid, live_id, code, kind, key, title, body)
Fake.f_livePush = f_livePush2

# ---- v11.2: turmas (privacidade, ranking, troféus, prestígio, desafios, campeonatos)
def _tminit(self):
    if not hasattr(self, 'pub'):
        self.pub = set(); self.tmatches = {}; self.champs = {}; self.trophies = []; self.v112_enabled = True
    if not self.v112_enabled: raise LookupError()
Fake._tminit = _tminit
def _tmreg(fn):
    def g(self, uid, *a):
        self._tminit(); return fn(self, uid, *a)
    g.__name__ = fn.__name__; setattr(Fake, fn.__name__, _wrap(g)); return fn
def _can_see(self, t, uid): return self.is_member(t, uid) or t in self.pub
def _tname(self, t): return (self.turmas.get(t) or {}).get('name')
def _prestige(self, t):
    n = sum(1 for b in self.babas.values() if b.get('finished') and t in (b.get('turma_ids') or []))
    pl = sum(1 for m in self.tmatches.values() if m['status'] == 'played' and t in (m['home'], m['away']))
    score = n * 2 + pl * 3
    return {'score': score, 'tier': 'prata' if score >= 100 else 'bronze', 'parts': [{'label': 'Babas (6 meses)', 'qty': n, 'pts': n * 2}, {'label': 'Desafios jogados', 'qty': pl, 'pts': pl * 3}]}
Fake._can_see = _can_see; Fake._tname = _tname; Fake._prestige = _prestige
def _mjson(self, m):
    return dict(m, home_name=self._tname(m['home']), away_name=self._tname(m['away']) if m.get('away') else None, home_icon=None, away_icon=None)
Fake._mjson = _mjson
@_tmreg
def f_setPrivacy(self, uid, t, pub):
    if not self._is_adm(t, uid): return self.err('P0001', 'not_allowed')
    (self.pub.add if pub else self.pub.discard)(t)
    if not pub:
        for m in self.tmatches.values():
            if m['home'] == t and m['status'] in ('open', 'pending'): m['status'] = 'canceled'
    return self.ok(None)
@_tmreg
def f_turmaPrestige(self, uid, t):
    if not self._can_see(t, uid): return self.err('P0001', 'not_found')
    return self.ok(dict(self._prestige(t), is_public=t in self.pub))
@_tmreg
def f_turmaRanking(self, uid, t, period, metric, lim):
    if not self._can_see(t, uid): return self.err('P0001', 'not_found')
    bs = sorted([b for b in self.babas.values() if b.get('finished') and t in (b.get('turma_ids') or [])], key=lambda b: b['played_on'])
    if period == 'last': bs = bs[-1:]
    tot = {}
    for b in bs:
        for s in self.stats.get(b['id'], []):
            r = tot.setdefault(s['name'], {'goals': 0, 'assists': 0, 'saves': 0, 'matches': 0, 'wins': 0, 'babas': 0})
            for k in ('goals', 'assists', 'saves', 'matches', 'wins'): r[k] += s.get(k) or 0
            r['babas'] += 1
    val = lambda r: r['goals'] + r['assists'] if metric == 'part' else r[metric]
    rows = sorted([(n, r) for n, r in tot.items() if val(r) > 0], key=lambda x: (-val(x[1]), x[1]['matches'], x[0]))[:min(max(lim or 10, 1), 26)]
    return self.ok({'period': period, 'season': '2026-S2', 'label': bs[-1]['played_on'] if bs and period == 'last' else '2026-S2', 'babas': len(bs),
                    'rows': [{'rank': i + 1, 'player_id': None, 'name': n, 'value': val(r), 'babas': r['babas'], 'matches': r['matches']} for i, (n, r) in enumerate(rows)]})
@_tmreg
def f_turmaTrophies(self, uid, t):
    if not self._can_see(t, uid): return self.err('P0001', 'not_found')
    return self.ok({'atletas': [x for x in self.trophies if x['turma_id'] == t and x['scope'] == 'atleta'], 'turma': [x for x in self.trophies if x['turma_id'] == t and x['scope'] == 'turma']})
@_tmreg
def f_exploreTurmas(self, uid, q, lim):
    rows = []
    for t, tr in self.turmas.items():
        if not (t in self.pub or self.is_member(t, uid)): continue
        if q and q.lower() not in (tr['name'] or '').lower(): continue
        rows.append({'id': t, 'name': tr['name'], 'icon': None, 'is_public': t in self.pub, 'member': self.is_member(t, uid), 'members': sum(1 for (tt, u) in self.members if tt == t),
                     'prestige': self._prestige(t), 'trophies': 0, 'last_baba': None})
    return self.ok(sorted(rows, key=lambda r: -r['prestige']['score']))
@_tmreg
def f_createMatch(self, uid, home, kind, away, starts, place, note):
    if not self._is_adm(home, uid): return self.err('P0001', 'not_allowed')
    if home not in self.pub: return self.err('P0001', 'home_private')
    if kind == 'amistoso_fechado' and (away not in self.pub): return self.err('P0001', 'away_private')
    mid = str(uuid.uuid4())
    self.tmatches[mid] = {'id': mid, 'kind': kind, 'home': home, 'away': away if kind == 'amistoso_fechado' else None, 'status': 'pending' if kind == 'amistoso_fechado' else 'open',
                          'starts_at': starts, 'place': place, 'note': note, 'championship': None, 'home_goals': None, 'away_goals': None, 'result_status': 'none', 'reported_by': None, 'reported_user': None,
                          'created_at': _dt.datetime.utcnow().isoformat() + str(len(self.tmatches)).zfill(3)}
    return self.ok(mid)
@_tmreg
def f_respondMatch(self, uid, m, accept, as_turma):
    x = self.tmatches.get(m)
    if not x: return self.err('P0001', 'not_found')
    if x['status'] == 'pending':
        if not self._is_adm(x['away'], uid): return self.err('P0001', 'not_allowed')
        x['status'] = 'accepted' if accept else 'declined'; return self.ok(x['status'])
    if x['status'] == 'open':
        if not as_turma or as_turma == x['home'] or not self._is_adm(as_turma, uid): return self.err('P0001', 'not_allowed')
        x['away'] = as_turma; x['status'] = 'accepted'; return self.ok('accepted')
    return self.err('P0001', 'closed')
@_tmreg
def f_cancelMatch(self, uid, m):
    x = self.tmatches.get(m)
    if not x: return self.err('P0001', 'not_found')
    x['status'] = 'canceled'; return self.ok(None)
@_tmreg
def f_scheduleMatch(self, uid, m, starts, place):
    x = self.tmatches.get(m)
    if not x: return self.err('P0001', 'not_found')
    x['starts_at'] = starts; x['place'] = place; return self.ok(None)
@_tmreg
def f_reportResult(self, uid, m, hg, ag):
    x = self.tmatches.get(m)
    if not x: return self.err('P0001', 'not_found')
    side = x['home'] if self._is_adm(x['home'], uid) else x['away']
    x.update(home_goals=hg, away_goals=ag, result_status='reported', reported_by=side, reported_user=uid); return self.ok(None)
@_tmreg
def f_confirmResult(self, uid, m, ok):
    x = self.tmatches.get(m)
    if not x or x['result_status'] != 'reported': return self.err('P0001', 'closed')
    other = x['away'] if x['reported_by'] == x['home'] else x['home']
    if not self._is_adm(other, uid) or x['reported_user'] == uid: return self.err('P0001', 'not_allowed')
    if ok:
        x.update(result_status='confirmed', status='played')
        if x['championship']: self._champ_progress(x['championship'])
        return self.ok('confirmed')
    x.update(result_status='none', home_goals=None, away_goals=None, reported_by=None, reported_user=None); return self.ok('disputed')
@_tmreg
def f_turmaMatches(self, uid, t):
    if not self._can_see(t, uid): return self.err('P0001', 'not_found')
    return self.ok([self._mjson(m) for m in sorted(self.tmatches.values(), key=lambda m: m['created_at'], reverse=True) if t in (m['home'], m['away']) and m['status'] not in ('declined', 'canceled')])
@_tmreg
def f_openMatches(self, uid):
    return self.ok([dict(self._mjson(m), prestige=self._prestige(m['home']), mine=self.is_member(m['home'], uid)) for m in self.tmatches.values() if m['status'] == 'open' and m['home'] in self.pub])
def _champ_table(self, c):
    rows = {t: {'turma': t, 'name': self._tname(t), 'icon': None, 'j': 0, 'v': 0, 'e': 0, 'd': 0, 'gp': 0, 'gc': 0, 'sg': 0, 'pts': 0} for t in self.champs[c]['teams']}
    for m in self.tmatches.values():
        if m['championship'] != c or m['status'] != 'played': continue
        for me, ot, gf, ga in ((m['home'], m['away'], m['home_goals'], m['away_goals']), (m['away'], m['home'], m['away_goals'], m['home_goals'])):
            r = rows[me]; r['j'] += 1; r['gp'] += gf; r['gc'] += ga; r['sg'] += gf - ga
            if gf > ga: r['v'] += 1; r['pts'] += 3
            elif gf == ga: r['e'] += 1; r['pts'] += 1
            else: r['d'] += 1
    return sorted(rows.values(), key=lambda r: (-r['pts'], -r['sg'], -r['gp'], r['name']))
def _champ_progress(self, c):
    ch = self.champs[c]
    if ch['status'] != 'andamento' or any(m['championship'] == c and m['status'] not in ('played', 'canceled') for m in self.tmatches.values()): return
    ch['status'] = 'encerrado'; ch['champion'] = self._champ_table(c)[0]['turma']
    self.trophies.append({'turma_id': ch['champion'], 'scope': 'turma', 'kind': 'campeonato', 'title': 'Campeão: ' + ch['name'], 'season': '2026-S2', 'ref': c})
Fake._champ_table = _champ_table; Fake._champ_progress = _champ_progress
@_tmreg
def f_createChampionship(self, uid, t, name, size):
    if not self._is_adm(t, uid): return self.err('P0001', 'not_allowed')
    if t not in self.pub: return self.err('P0001', 'home_private')
    cid = str(uuid.uuid4()); self.champs[cid] = {'id': cid, 'name': name, 'organizer': t, 'max_teams': size, 'status': 'inscricoes', 'champion': None, 'teams': [t]}
    return self.ok(cid)
@_tmreg
def f_joinChampionship(self, uid, c, t):
    ch = self.champs.get(c)
    if not ch: return self.err('P0001', 'not_found')
    if not self._is_adm(t, uid): return self.err('P0001', 'not_allowed')
    if ch['status'] != 'inscricoes': return self.err('P0001', 'closed')
    if len(ch['teams']) >= ch['max_teams']: return self.err('P0001', 'full')
    if t not in ch['teams']: ch['teams'].append(t)
    return self.ok(None)
@_tmreg
def f_leaveChampionship(self, uid, c, t):
    ch = self.champs.get(c)
    if ch and t in ch['teams'] and t != ch['organizer']: ch['teams'].remove(t)
    return self.ok(None)
@_tmreg
def f_startChampionship(self, uid, c):
    ch = self.champs.get(c)
    if not ch or not self._is_adm(ch['organizer'], uid): return self.err('P0001', 'not_allowed')
    if len(ch['teams']) < 3: return self.err('P0001', 'few_teams')
    n = 0
    for i in range(len(ch['teams'])):
        for j in range(i + 1, len(ch['teams'])):
            mid = str(uuid.uuid4()); n += 1
            self.tmatches[mid] = {'id': mid, 'kind': 'campeonato', 'home': ch['teams'][i], 'away': ch['teams'][j], 'status': 'accepted', 'starts_at': None, 'place': None, 'note': None, 'championship': c,
                                  'home_goals': None, 'away_goals': None, 'result_status': 'none', 'reported_by': None, 'reported_user': None, 'created_at': _dt.datetime.utcnow().isoformat() + str(len(self.tmatches)).zfill(3)}
    ch['status'] = 'andamento'; return self.ok(n)
@_tmreg
def f_cancelChampionship(self, uid, c):
    ch = self.champs.get(c)
    if not ch or not self._is_adm(ch['organizer'], uid): return self.err('P0001', 'not_allowed')
    ch['status'] = 'cancelado'; return self.ok(None)
@_tmreg
def f_listChampionships(self, uid):
    return self.ok([{'id': c['id'], 'name': c['name'], 'organizer': c['organizer'], 'organizer_name': self._tname(c['organizer']), 'status': c['status'], 'max_teams': c['max_teams'], 'teams': len(c['teams']),
                     'champion': c['champion'], 'champion_name': self._tname(c['champion']) if c['champion'] else None, 'mine': any(self.is_member(t, uid) for t in c['teams'])}
                    for c in self.champs.values() if c['status'] != 'cancelado'])
@_tmreg
def f_championshipDetail(self, uid, c):
    ch = self.champs.get(c)
    if not ch or ch['status'] == 'cancelado': return self.err('P0001', 'not_found')
    return self.ok({'id': c, 'name': ch['name'], 'status': ch['status'], 'organizer': ch['organizer'], 'max_teams': ch['max_teams'], 'champion': ch['champion'],
                    'teams': [{'id': t, 'name': self._tname(t), 'icon': None} for t in ch['teams']], 'table': self._champ_table(c) if ch['status'] != 'inscricoes' else [],
                    'matches': [self._mjson(m) for m in self.tmatches.values() if m['championship'] == c and m['status'] != 'canceled']})

# ---- v11.4: palpites pré-jogo (mesma matemática do SQL; o banco de verdade é testado em supabase/test/v11_4_rules.sql)
import math
def _pmf(lam, k): return math.exp(-lam) * lam ** k / math.factorial(k)
def _pover(lam, l): return 1 - sum(_pmf(lam, x) for x in range(int(math.floor(l)) + 1))
def _codd(p): return 20.0 if p <= 0 else min(max(round(0.9 / p + 1e-9, 2), 1.05), 20.0)
def _pick_line(lam):
    best, bd = None, 9
    if lam <= 0: return None
    for l in [g + 0.5 for g in range(6)]:
        p = _pover(lam, l)
        if 0.35 <= p <= 0.65 and abs(p - 0.5) < bd: best, bd = l, abs(p - 0.5)
    return best
def _fl(l): return f'{l:.1f}'.replace('.', ',')
def _sels(kind, lam, line):
    if kind == 'ou':
        p = _pover(lam, line)
        return [{'key': 'mais', 'label': 'Mais ' + _fl(line), 'odd': _codd(p), 'p': round(p, 4)}, {'key': 'menos', 'label': 'Menos ' + _fl(line), 'odd': _codd(1 - p), 'p': round(1 - p, 4)}]
    out = [{'key': str(k), 'label': str(k), 'odd': _codd(_pmf(lam, k)), 'p': round(_pmf(lam, k), 4)} for k in range(6)]
    p = 1 - sum(_pmf(lam, k) for k in range(6)); out.append({'key': '6+', 'label': '6 ou mais', 'odd': _codd(p), 'p': round(p, 4)}); return out
def _ladder(lam):
    out = []
    for l in [g + 0.5 for g in range(6)]:
        p = _pover(lam, l); okm = 0.05 <= p <= 0.85; oku = 0.05 <= 1 - p <= 0.85
        if okm or oku: out.append({'line': l, 'mais': {'odd': _codd(p), 'p': round(p, 4), 'ok': okm}, 'menos': {'odd': _codd(1 - p), 'p': round(1 - p, 4), 'ok': oku}})
    return out
def _utc(s): return _dt.datetime.fromisoformat(str(s).replace('Z', '+00:00')).replace(tzinfo=None) if str(s).endswith('Z') or '+' in str(s)[10:] else _dt.datetime.fromisoformat(str(s))
def _pinit(self):
    self._evinit()
    if not hasattr(self, 'pmk'): self.pmk = {}; self.pbets = []; self.v114_enabled = True
    if not self.v114_enabled: raise LookupError()
Fake._pinit = _pinit
def _ev_linked(self, eid): return [b for b in self.babas.values() if b.get('event_id') == eid]
def _p_locked(self, e):
    if _utc(e['starts_at']) <= _dt.datetime.utcnow(): return True
    return any(b.get('finished') or (b.get('state') or {}).get('firstKickoffAt') for b in self._ev_linked(e['id']))
def _p_generate(self, e):
    eid = e['id']
    if e['status'] != 'open' or self._p_locked(e): return
    conf = [r for (x, k), r in self.rsvps.items() if x == eid and r['status'] == 'vou']
    if len(conf) < 4: return
    wins = sorted([b for b in self.babas.values() if b.get('finished') and e['turma_id'] in (b.get('turma_ids') or [])], key=lambda b: (b['played_on'], b.get('updated', 0)), reverse=True)[:10]
    pl = {p['id']: p for p in self.players.values() if p['turma_id'] == e['turma_id']}
    def pid_of(s): return s.get('turma_player_id') or next((p['id'] for p in pl.values() if p['name'].strip().lower() == s['name'].strip().lower()), None)
    ath = {}
    for age, b in enumerate(wins):
        w = 0.5 ** (age / 4.0); per = {}
        for s in self.stats.get(b['id'], []):
            pid = pid_of(s)
            if not pid: continue
            d = per.setdefault(pid, {'g': 0, 'a': 0, 'sv': 0, 'm': 0})
            d['g'] += s.get('goals', 0); d['a'] += s.get('assists', 0); d['sv'] += s.get('saves', 0); d['m'] += s.get('matches', 0)
        for pid, d in per.items():
            a = ath.setdefault(pid, {'n': 0, 'wm': 0, 'wg': 0, 'wa': 0, 'wsv': 0})
            if d['m'] > 0: a['n'] += 1
            a['wm'] += d['m'] * w; a['wg'] += d['g'] * w; a['wa'] += d['a'] * w; a['wsv'] += d['sv'] * w
    grp = {}
    for pid, a in ath.items():
        g = grp.setdefault(bool(pl[pid].get('is_goalkeeper')), {'wm': 0, 'wg': 0, 'wa': 0, 'wsv': 0})
        for k in ('wm', 'wg', 'wa', 'wsv'): g[k] += a[k]
    pavg = (sum(b.get('matches', 0) for b in wins) / len(wins)) if wins else 0
    ej = 2 * (pavg or 6) * 5 / len(conf)
    for r in conf:
        pid = r.get('turma_player_id')
        if not pid or pid not in pl: continue
        gk = bool(pl[pid].get('is_goalkeeper')); g = grp.get(gk)
        if not g or g['wm'] <= 0: continue
        a = ath.get(pid, {'n': 0, 'wm': 0, 'wg': 0, 'wa': 0, 'wsv': 0}); n = a['n']
        def adj(x, tx):
            r_ath = a[x] / a['wm'] if a['wm'] > 0 else 0
            return (n * r_ath + 3 * (g[tx] / g['wm'])) / (n + 3)
        def add(kind, metric, lam, line):
            key = (eid, pid, kind, metric)
            if any((m['event_id'], m['player_id'], m['kind'], m['metric']) == key for m in self.pmk.values()): return
            mid = str(uuid.uuid4())
            self.pmk[mid] = {'id': mid, 'event_id': eid, 'turma_id': e['turma_id'], 'player_id': pid, 'kind': kind, 'metric': metric, 'line': line, 'selections': _sels(kind, lam, line),
                             'lambda': lam, 'rookie': n == 0, 'status': 'open', 'result': None, 'void_reason': None, 'edited_by': None}
        if not gk:
            lam = round(adj('wg', 'wg') * ej, 4); ln = _pick_line(lam)
            if ln is not None: add('ou', 'goals', lam, ln); add('exact', 'goals', lam, None)
            lam = round(adj('wa', 'wa') * ej, 4); ln = _pick_line(lam)
            if ln is not None: add('ou', 'assists', lam, ln)
            lam = round((adj('wg', 'wg') + adj('wa', 'wa')) * ej, 4); ln = _pick_line(lam)
            if ln is not None: add('ou', 'ga', lam, ln)
        else:
            lam = round(adj('wsv', 'wsv') * ej, 4); ln = _pick_line(lam)
            if ln is not None: add('ou', 'saves', lam, ln)
def _p_void(self, m, why):
    if m['status'] not in ('open', 'locked'): return
    m['status'] = 'void'; m['void_reason'] = why; m['result'] = {'void': why}
    for b in self.pbets:
        if b['market'] == m['id'] and b['status'] == 'open':
            b['status'] = 'void'; b['payout'] = b['stake']; self._add(b['user'], b['stake'], 'palpite-pre-devolvido', str(b['id']))
def _p_settle(self, eid):
    done = [b for b in self.babas.values() if b.get('event_id') == eid and b.get('finished')]
    if not done or not self.stats.get(done[0]['id']): return
    bid = done[0]['id']
    for m in [m for m in self.pmk.values() if m['event_id'] == eid and m['status'] in ('open', 'locked', 'settled')]:
        pname = self.players[m['player_id']]['name'].strip().lower()
        rows = [s for s in self.stats[bid] if s.get('turma_player_id') == m['player_id'] or (not s.get('turma_player_id') and s['name'].strip().lower() == pname)]
        mt = sum(s.get('matches', 0) for s in rows)
        if mt == 0:
            m['status'] = 'locked'; self._p_void(m, 'ausente'); m['void_reason'] = 'ausente'; continue
        val = {'goals': sum(s.get('goals', 0) for s in rows), 'assists': sum(s.get('assists', 0) for s in rows), 'saves': sum(s.get('saves', 0) for s in rows)}.get(m['metric'])
        if val is None: val = sum(s.get('goals', 0) + s.get('assists', 0) for s in rows)
        win = ('mais' if val > m['line'] else 'menos') if m['kind'] == 'ou' else ('6+' if val >= 6 else str(val))
        res = {'value': val, 'win': win}
        if m['status'] == 'settled' and m['result'] == res: continue
        m['status'] = 'settled'; m['result'] = res
        for b in self.pbets:
            if b['market'] == m['id'] and b['status'] == 'open':
                bl = b.get('line') or m['line']
                hit = ((b['selection'] == 'mais' and val > bl) or (b['selection'] == 'menos' and val < bl)) if m['kind'] == 'ou' else b['selection'] == win
                if hit: b['status'] = 'won'; b['payout'] = math.floor(b['stake'] * b['odd']); self._add(b['user'], b['payout'], 'palpite-pre-ganho', str(b['id']))
                else: b['status'] = 'lost'
def _p_refresh(self, e):
    if e['status'] == 'canceled':
        for m in self.pmk.values():
            if m['event_id'] == e['id']: self._p_void(m, 'cancelado')
        return
    if _utc(e['starts_at']) < _dt.datetime.utcnow() - _dt.timedelta(hours=72) and not any(b.get('finished') for b in self._ev_linked(e['id'])):
        for m in self.pmk.values():
            if m['event_id'] == e['id']: self._p_void(m, 'expirado')
    if self._p_locked(e):
        for m in self.pmk.values():
            if m['event_id'] == e['id'] and m['status'] == 'open': m['status'] = 'locked'
    self._p_settle(e['id']); self._p_generate(e)
Fake._ev_linked = _ev_linked; Fake._p_locked = _p_locked; Fake._p_generate = _p_generate; Fake._p_void = _p_void; Fake._p_settle = _p_settle; Fake._p_refresh = _p_refresh
def _preg(fn):
    def g(self, uid, *a):
        self._pinit(); self._need(uid); return fn(self, uid, *a)
    g.__name__ = fn.__name__
    def safe(self, uid, *a):
        try: return g(self, uid, *a)
        except LookupError: return self.err('PGRST202', 'Could not find the function')
        except PermissionError as e: return self.err('P0001', str(e))
    safe.__name__ = fn.__name__; setattr(Fake, fn.__name__, safe); return fn
@_preg
def f_propMarkets(self, uid, eid):
    e = self.events.get(eid)
    if not e or not self.is_member(e['turma_id'], uid): raise PermissionError('not_member')
    self._p_refresh(e)
    locked = self._p_locked(e) or e['status'] != 'open'
    ms = []
    for m in sorted([m for m in self.pmk.values() if m['event_id'] == eid], key=lambda m: (self.players[m['player_id']]['name'], {'goals': 1, 'assists': 2, 'ga': 3}.get(m['metric'], 4), 0 if m['kind'] == 'ou' else 1)):
        pl = self.players[m['player_id']]; mine = next((b for b in self.pbets if b['market'] == m['id'] and b['user'] == uid), None)
        ms.append({'id': m['id'], 'player_id': m['player_id'], 'player': pl['name'], 'keeper': bool(pl.get('is_goalkeeper')), 'mine': pl.get('user_id') == uid, 'kind': m['kind'], 'metric': m['metric'],
                   'line': m['line'], 'selections': m['selections'], 'ladder': _ladder(m['lambda']) if m['kind'] == 'ou' else None, 'rookie': m['rookie'], 'status': m['status'], 'result': m['result'], 'void_reason': m['void_reason'],
                   'adjusted': m['edited_by'] is not None, 'has_bets': any(b['market'] == m['id'] for b in self.pbets),
                   'bet': dict({k: mine[k] for k in ('selection', 'stake', 'odd', 'status', 'payout')}, line=mine.get('line') or m['line']) if mine else None})
    return self.ok({'event_id': eid, 'turma_id': e['turma_id'], 'starts_at': e['starts_at'], 'locked': locked, 'admin': self._is_adm(e['turma_id'], uid), 'adult': self._adult(uid),
                    'confirmed': sum(1 for (x, k), r in self.rsvps.items() if x == eid and r['status'] == 'vou'), 'markets': ms})
@_preg
def f_propOpenCounts(self, uid, ids):
    out = {}
    for eid in ids:
        e = self.events.get(eid)
        if not e or not self.is_member(e['turma_id'], uid): continue
        self._p_refresh(e); out[eid] = sum(1 for m in self.pmk.values() if m['event_id'] == eid and m['status'] == 'open')
    return self.ok(out)
@_preg
def f_placePropBet(self, uid, mid, selection, stake, p_line=None):
    m = self.pmk.get(mid)
    if not m: raise PermissionError('market_closed')
    e = self.events[m['event_id']]
    if not self.is_member(m['turma_id'], uid): raise PermissionError('not_member')
    if not self._adult(uid): raise PermissionError('not_adult')
    self._p_refresh(e); m = self.pmk[mid]
    if m['status'] == 'locked': raise PermissionError('locked')
    if m['status'] != 'open' or e['status'] != 'open': raise PermissionError('market_closed')
    if not isinstance(stake, int) or stake < 10: raise PermissionError('bad_stake')
    mine_p = self.players[m['player_id']].get('user_id') == uid
    ln = None
    if m['kind'] == 'ou':
        if selection not in ('mais', 'menos'): raise PermissionError('bad_selection')
        ln = p_line if p_line is not None else m['line']
        ent = next((x for x in _ladder(m['lambda']) if x['line'] == ln), None)
        if not ent or not ent[selection]['ok']: raise PermissionError('bad_line')
        sel = {'odd': ent[selection]['odd']}
    else:
        sel = next((s for s in m['selections'] if s['key'] == selection), None)
        if not sel: raise PermissionError('bad_selection')
        if mine_p and m['metric'] == 'goals': raise PermissionError('self_exact')
    if mine_p and selection == 'menos': raise PermissionError('self_under')
    if any(b['market'] == mid and b['user'] == uid for b in self.pbets): raise PermissionError('already_bet')
    self.f_myWallet(uid); bid = len(self.pbets) + 1
    bal = self._add(uid, -stake, 'palpite-pre', str(bid))
    self.pbets.append({'id': bid, 'market': mid, 'user': uid, 'selection': selection, 'line': ln, 'stake': stake, 'odd': sel['odd'], 'status': 'open', 'payout': 0})
    return self.ok({'bet_id': bid, 'balance': bal, 'odd': sel['odd'], 'payout': math.floor(stake * sel['odd'])})
@_preg
def f_adjustPropLine(self, uid, mid, line):
    m = self.pmk.get(mid)
    if not m: raise PermissionError('market_closed')
    if not self._is_adm(m['turma_id'], uid): raise PermissionError('not_allowed')
    self._p_refresh(self.events[m['event_id']]); m = self.pmk[mid]
    if m['status'] == 'locked': raise PermissionError('locked')
    if m['status'] != 'open' or m['kind'] != 'ou': raise PermissionError('market_closed')
    if any(b['market'] == mid for b in self.pbets): raise PermissionError('has_bets')
    if not (0.5 <= line <= 5.5) or line % 1 != 0.5 or abs(line - m['line']) != 1: raise PermissionError('bad_line')
    m['line'] = line; m['selections'] = _sels('ou', m['lambda'], line); m['edited_by'] = uid
    return self.ok({'line': line})
@_preg
def f_suspendPropMarket(self, uid, mid):
    m = self.pmk.get(mid)
    if not m: raise PermissionError('market_closed')
    if not self._is_adm(m['turma_id'], uid): raise PermissionError('not_allowed')
    if m['status'] not in ('open', 'locked'): raise PermissionError('market_closed')
    n = sum(1 for b in self.pbets if b['market'] == mid and b['status'] == 'open')
    self._p_void(m, 'suspenso'); m['edited_by'] = uid; return self.ok(n)
@_preg
def f_propEventBets(self, uid, eid):
    e = self.events.get(eid)
    if not e or not self._is_adm(e['turma_id'], uid): raise PermissionError('not_allowed')
    linked = _ev_linked(self, eid); rec = linked[-1]['created_by'] if linked else e['created_by']
    rows = []
    for b in self.pbets:
        m = self.pmk[b['market']]
        if m['event_id'] != eid: continue
        rows.append({'user_id': b['user'], 'name': self.profiles.get(b['user'], {}).get('name'), 'player': self.players[m['player_id']]['name'], 'metric': m['metric'], 'kind': m['kind'], 'line': b.get('line') or m['line'],
                     'selection': b['selection'], 'stake': b['stake'], 'odd': b['odd'], 'status': b['status'], 'payout': b['payout'], 'recorder': b['user'] == rec})
    return self.ok(rows)
# liquidação ao gravar os stats do baba (o banco faz o mesmo no trigger de baba_stats)
_old_replace = Fake.f_replaceStats
def _replace_stats_p(self, uid, bid, rows):
    r = _old_replace(self, uid, bid, rows)
    if hasattr(self, 'pmk') and 'err' not in (r or {}):
        b = self.babas.get(bid)
        if b and b.get('event_id') and b['event_id'] in self.events: self._p_settle(b['event_id'])
    return r
Fake.f_replaceStats = _replace_stats_p

# ---- v11.5: Duelo, Destaque do dia, Total do baba, ranking de palpiteiros e troféus (o banco de verdade é testado em supabase/test/v11_5_rules.sql)
# Só liga com fake.v115_enabled = True (os smokes antigos continuam vendo só os mercados da v11.4).
def _p_rates(self, e):
    eid = e['id']
    conf = [r for (x, k), r in self.rsvps.items() if x == eid and r['status'] == 'vou']
    if not conf: return []
    wins = sorted([b for b in self.babas.values() if b.get('finished') and e['turma_id'] in (b.get('turma_ids') or [])], key=lambda b: (b['played_on'], b.get('updated', 0)), reverse=True)[:10]
    pl = {p['id']: p for p in self.players.values() if p['turma_id'] == e['turma_id']}
    def pid_of(s): return s.get('turma_player_id') or next((p['id'] for p in pl.values() if p['name'].strip().lower() == s['name'].strip().lower()), None)
    ath = {}
    for age, b in enumerate(wins):
        w = 0.5 ** (age / 4.0); per = {}
        for s in self.stats.get(b['id'], []):
            pid = pid_of(s)
            if not pid: continue
            d = per.setdefault(pid, {'g': 0, 'a': 0, 'sv': 0, 'm': 0})
            d['g'] += s.get('goals', 0); d['a'] += s.get('assists', 0); d['sv'] += s.get('saves', 0); d['m'] += s.get('matches', 0)
        for pid, d in per.items():
            a = ath.setdefault(pid, {'n': 0, 'wm': 0, 'wg': 0, 'wa': 0, 'wsv': 0})
            if d['m'] > 0: a['n'] += 1
            a['wm'] += d['m'] * w; a['wg'] += d['g'] * w; a['wa'] += d['a'] * w; a['wsv'] += d['sv'] * w
    grp = {}
    for pid, a in ath.items():
        g = grp.setdefault(bool(pl[pid].get('is_goalkeeper')), {'wm': 0, 'wg': 0, 'wa': 0, 'wsv': 0})
        for k in ('wm', 'wg', 'wa', 'wsv'): g[k] += a[k]
    pavg = (sum(b.get('matches', 0) for b in wins) / len(wins)) if wins else 0
    ej = 2 * (pavg or 6) * 5 / len(conf)
    out = []
    for r in conf:
        pid = r.get('turma_player_id')
        if not pid or pid not in pl: continue
        gk = bool(pl[pid].get('is_goalkeeper')); g = grp.get(gk)
        if not g or g['wm'] <= 0: continue
        a = ath.get(pid, {'n': 0, 'wm': 0, 'wg': 0, 'wa': 0, 'wsv': 0}); n = a['n']
        def adj(x):
            r_ath = a[x] / a['wm'] if a['wm'] > 0 else 0
            return (n * r_ath + 3 * (g[x] / g['wm'])) / (n + 3)
        out.append({'pid': pid, 'gk': gk, 'n': n, 'lg': round(adj('wg') * ej, 4), 'la': round(adj('wa') * ej, 4), 'lga': round((adj('wg') + adj('wa')) * ej, 4), 'ls': round(adj('wsv') * ej, 4)})
    return out
def _duel_p(la, lb):
    win = sum(_pmf(la, a) * _pmf(lb, b) for a in range(16) for b in range(16) if a > b)
    lose = sum(_pmf(la, a) * _pmf(lb, b) for a in range(16) for b in range(16) if b > a)
    return None if win + lose <= 0 else win / (win + lose)
def _leader_sel(opts):
    cdf = {o['key']: [sum(_pmf(o['lam'], x) for x in range(k + 1)) for k in range(16)] for o in opts}
    out = []
    for o in opts:
        p = 0
        for k in range(16):
            prod = 1
            for j in opts:
                if j['key'] != o['key']: prod *= cdf[j['key']][k]
            p += _pmf(o['lam'], k) * prod
        out.append({'key': o['key'], 'lam': o['lam'], 'p': round(p, 4), 'odd': _codd(p)})
    return sorted(out, key=lambda x: (-x['p'], x['key']))
def _total_hist(self, t):
    wins = sorted([b for b in self.babas.values() if b.get('finished') and t in (b.get('turma_ids') or [])], key=lambda b: (b['played_on'], b.get('updated', 0)), reverse=True)[:10]
    return [{'w': 0.5 ** (age / 4.0), 'matches': b.get('matches', 0), 'goals': sum(s.get('goals', 0) for s in self.stats.get(b['id'], []))} for age, b in enumerate(wins)]
def _total_sel(self, t, metric, line):
    h = _total_hist(self, t); sw = sum(x['w'] for x in h)
    om = sum(x['w'] for x in h if x[metric] > line); ou = sum(x['w'] for x in h if x[metric] < line)
    pm = (om + 0.5) / (sw + 1); pu = (ou + 0.5) / (sw + 1); s = pm + pu; pm, pu = pm / s, pu / s
    return [{'key': 'mais', 'label': 'Mais ' + _fl(line), 'odd': _codd(pm), 'p': round(pm, 4)}, {'key': 'menos', 'label': 'Menos ' + _fl(line), 'odd': _codd(pu), 'p': round(pu, 4)}]
def _total_line(self, t, metric):
    h = _total_hist(self, t)
    if len(h) < 5: return None
    best, bd = None, 9
    for g in range(int(max(x[metric] for x in h)) + 1):
        l = g + 0.5; p = _total_sel(self, t, metric, l)[0]['p']
        if 0.35 <= p <= 0.65 and abs(p - 0.5) < bd: best, bd = l, abs(p - 0.5)
    return best
def _new_market(self, e, kind, metric, sels, pid=None, pid2=None, line=None, lam=None):
    mid = str(uuid.uuid4())
    self.pmk[mid] = {'id': mid, 'event_id': e['id'], 'turma_id': e['turma_id'], 'player_id': pid, 'player2_id': pid2, 'kind': kind, 'metric': metric, 'line': line, 'selections': sels,
                     'lambda': lam, 'rookie': False, 'status': 'open', 'result': None, 'void_reason': None, 'edited_by': None}
_old_generate = Fake._p_generate
def _p_generate2(self, e):
    _old_generate(self, e)
    if not getattr(self, 'v115_enabled', False) or e['status'] != 'open' or self._p_locked(e): return
    if sum(1 for (x, k), r in self.rsvps.items() if x == e['id'] and r['status'] == 'vou') < 4: return
    eid = e['id']; rates = _p_rates(self, e); mk = [m for m in self.pmk.values() if m['event_id'] == eid]
    duels = [m for m in mk if m['kind'] == 'duel']; used = {x for m in duels for x in (m['player_id'], m['player2_id'])}
    prev = None
    for r in sorted([r for r in rates if not r['gk'] and r['n'] > 0 and r['lga'] > 0 and r['pid'] not in used], key=lambda r: (-r['lga'], r['pid'])):
        if len(duels) >= 3: break
        if prev is None: prev = r; continue
        p = _duel_p(prev['lga'], r['lga'])
        if p is not None and 0.35 <= p <= 0.65:
            _new_market(self, e, 'duel', 'ga', [{'key': prev['pid'], 'lam': prev['lga'], 'odd': _codd(p), 'p': round(p, 4)}, {'key': r['pid'], 'lam': r['lga'], 'odd': _codd(1 - p), 'p': round(1 - p, 4)}], prev['pid'], r['pid'], lam=prev['lga'])
            duels.append(1); prev = None
        else: prev = r
    for metric, key, mn in (('goals', 'lg', 4), ('assists', 'la', 4), ('saves', 'ls', 2)):
        cand = [{'key': r['pid'], 'lam': r[key]} for r in rates if r['gk'] == (metric == 'saves')]
        m = next((m for m in mk if m['kind'] == 'leader' and m['metric'] == metric), None)
        if not m:
            if len(cand) >= mn: _new_market(self, e, 'leader', metric, _leader_sel(cand))
        elif m['status'] == 'open':
            have = {s['key'] for s in m['selections']}
            extra = [c for c in cand if c['key'] not in have]
            if extra: m['selections'] = _leader_sel([{'key': s['key'], 'lam': s['lam']} for s in m['selections']] + extra)
    for metric in ('matches', 'goals'):
        if any(m['kind'] == 'baba_total' and m['metric'] == metric for m in mk): continue
        ln = _total_line(self, e['turma_id'], metric)
        if ln is not None: _new_market(self, e, 'baba_total', metric, _total_sel(self, e['turma_id'], metric, ln), line=ln)
Fake._p_generate = _p_generate2
def _pstat(self, bid, pid):
    pl = self.players.get(pid) or {}; pn = (pl.get('name') or '').strip().lower()
    rows = [s for s in self.stats.get(bid, []) if s.get('turma_player_id') == pid or (not s.get('turma_player_id') and s['name'].strip().lower() == pn)]
    return {'g': sum(s.get('goals', 0) for s in rows), 'a': sum(s.get('assists', 0) for s in rows), 'sv': sum(s.get('saves', 0) for s in rows), 'mt': sum(s.get('matches', 0) for s in rows)}
_old_settle = Fake._p_settle
def _p_settle2(self, eid):
    # os mercados por atleta ficam com a liquidação de antes (que não conhece os tipos novos)
    novos = {k: m for k, m in self.pmk.items() if m['kind'] in ('duel', 'leader', 'baba_total')}
    for k in novos: del self.pmk[k]
    try: _old_settle(self, eid)
    finally: self.pmk.update(novos)
    done = [b for b in self.babas.values() if b.get('event_id') == eid and b.get('finished')]
    if not done or not self.stats.get(done[0]['id']): return
    bb = done[0]; bid = bb['id']
    for m in [m for m in novos.values() if m['event_id'] == eid and m['status'] in ('open', 'locked')]:
        win, tops, absent, why = None, [], [], None
        if m['kind'] == 'duel':
            a, b = _pstat(self, bid, m['player_id']), _pstat(self, bid, m['player2_id'])
            if not a['mt'] or not b['mt']: why = 'ausente'
            else:
                va, vb = a['g'] + a['a'], b['g'] + b['a']; win = m['player_id'] if va > vb else m['player2_id'] if vb > va else None
                res = {'value': va, 'value2': vb, 'win': win or 'empate'}
        elif m['kind'] == 'leader':
            played = []
            for s in m['selections']:
                st = _pstat(self, bid, s['key'])
                if not st['mt']: absent.append(s['key'])
                else: played.append((s['key'], {'goals': st['g'], 'assists': st['a'], 'saves': st['sv']}[m['metric']]))
            top = max([v for _, v in played], default=0)
            if not top: why = 'zero'
            else: tops = sorted(k for k, v in played if v == top); res = {'value': top, 'win': tops, 'absent': sorted(absent)}
        else:
            val = bb.get('matches', 0) if m['metric'] == 'matches' else sum(s.get('goals', 0) for s in self.stats[bid])
            win = 'mais' if val > m['line'] else 'menos' if val < m['line'] else None; res = {'value': val, 'win': win or 'empate'}
        if why: m['status'] = 'locked'; self._p_void(m, why); continue
        m['status'] = 'settled'; m['result'] = res
        for b in self.pbets:
            if b['market'] != m['id'] or b['status'] != 'open': continue
            if (m['kind'] != 'leader' and win is None) or (m['kind'] == 'leader' and b['selection'] in absent):
                b['status'] = 'void'; b['payout'] = b['stake']; self._add(b['user'], b['stake'], 'palpite-pre-devolvido', str(b['id'])); continue
            if (b['selection'] in tops) if m['kind'] == 'leader' else (b['selection'] == win):
                b['status'] = 'won'; b['payout'] = math.floor(b['stake'] * b['odd'] / (len(tops) if m['kind'] == 'leader' else 1)); self._add(b['user'], b['payout'], 'palpite-pre-ganho', str(b['id']))
            else: b['status'] = 'lost'
Fake._p_settle = _p_settle2
def _mjson(self, m, uid):
    pl = self.players.get(m['player_id']) or {}; p2 = self.players.get(m.get('player2_id')) or {}
    mine = next((b for b in self.pbets if b['market'] == m['id'] and b['user'] == uid), None)
    sels = m['selections']
    if m['kind'] in ('duel', 'leader'):
        sels = [dict(s, label=(self.players.get(s['key']) or {}).get('name', '?'), mine=(self.players.get(s['key']) or {}).get('user_id') == uid) for s in sels]
    return {'id': m['id'], 'player_id': m['player_id'], 'player': pl.get('name'), 'keeper': bool(pl.get('is_goalkeeper')), 'mine': bool(pl) and pl.get('user_id') == uid, 'kind': m['kind'], 'metric': m['metric'],
            'player2_id': m.get('player2_id'), 'player2': p2.get('name'), 'mine2': bool(p2) and p2.get('user_id') == uid,
            'line': m['line'], 'selections': sels, 'ladder': _ladder(m['lambda']) if m['kind'] == 'ou' else None, 'rookie': m['rookie'], 'status': m['status'], 'result': m['result'], 'void_reason': m['void_reason'],
            'adjusted': m['edited_by'] is not None, 'has_bets': any(b['market'] == m['id'] for b in self.pbets),
            'bet': dict({k: mine[k] for k in ('selection', 'stake', 'odd', 'status', 'payout')}, line=mine.get('line') or m['line']) if mine else None}
@_preg
def f_propMarkets(self, uid, eid):
    e = self.events.get(eid)
    if not e or not self.is_member(e['turma_id'], uid): raise PermissionError('not_member')
    self._p_refresh(e)
    locked = self._p_locked(e) or e['status'] != 'open'
    rank = {'ou': 0, 'exact': 0, 'duel': 1, 'leader': 2, 'baba_total': 3}
    key = lambda m: (rank[m['kind']], (self.players.get(m['player_id']) or {}).get('name', ''), {'goals': 1, 'assists': 2, 'ga': 3, 'saves': 4, 'matches': 5}.get(m['metric'], 6), 0 if m['kind'] == 'ou' else 1)
    ms = [_mjson(self, m, uid) for m in sorted([m for m in self.pmk.values() if m['event_id'] == eid], key=key)]
    return self.ok({'event_id': eid, 'turma_id': e['turma_id'], 'starts_at': e['starts_at'], 'locked': locked, 'admin': self._is_adm(e['turma_id'], uid), 'adult': self._adult(uid),
                    'confirmed': sum(1 for (x, k), r in self.rsvps.items() if x == eid and r['status'] == 'vou'), 'markets': ms})
_old_place = Fake.f_placePropBet
def f_placePropBet(self, uid, mid, selection, stake, p_line=None):
    m = (getattr(self, 'pmk', {}) or {}).get(mid)
    if not m or m['kind'] in ('ou', 'exact'): return _old_place(self, uid, mid, selection, stake, p_line)
    try:
        self._pinit(); self._need(uid)
        e = self.events[m['event_id']]
        if not self.is_member(m['turma_id'], uid): raise PermissionError('not_member')
        if not self._adult(uid): raise PermissionError('not_adult')
        self._p_refresh(e); m = self.pmk[mid]
        if m['status'] == 'locked': raise PermissionError('locked')
        if m['status'] != 'open' or e['status'] != 'open': raise PermissionError('market_closed')
        if not isinstance(stake, int) or stake < 10: raise PermissionError('bad_stake')
        sel = next((s for s in m['selections'] if s['key'] == selection), None)
        if not sel: raise PermissionError('bad_selection')
        if m['kind'] == 'duel':
            ua = (self.players.get(m['player_id']) or {}).get('user_id'); ub = (self.players.get(m['player2_id']) or {}).get('user_id')
            if (ua == uid and selection == m['player2_id']) or (ub == uid and selection == m['player_id']): raise PermissionError('self_against')
        if any(b['market'] == mid and b['user'] == uid for b in self.pbets): raise PermissionError('already_bet')
        self.f_myWallet(uid); bid = len(self.pbets) + 1
        bal = self._add(uid, -stake, 'palpite-pre', str(bid))
        self.pbets.append({'id': bid, 'market': mid, 'user': uid, 'selection': selection, 'line': m['line'] if m['kind'] == 'baba_total' else None, 'stake': stake, 'odd': sel['odd'], 'status': 'open', 'payout': 0})
        return self.ok({'bet_id': bid, 'balance': bal, 'odd': sel['odd'], 'payout': math.floor(stake * sel['odd'])})
    except PermissionError as ex: return self.err('P0001', str(ex))
Fake.f_placePropBet = f_placePropBet
_old_adjust = Fake.f_adjustPropLine
def f_adjustPropLine(self, uid, mid, line):
    m = (getattr(self, 'pmk', {}) or {}).get(mid)
    if not m or m['kind'] != 'baba_total': return _old_adjust(self, uid, mid, line)
    if not self._is_adm(m['turma_id'], uid): return self.err('P0001', 'not_allowed')
    if m['status'] != 'open': return self.err('P0001', 'market_closed')
    if any(b['market'] == mid for b in self.pbets): return self.err('P0001', 'has_bets')
    if line < 0.5 or abs(line - m['line']) != 0.5: return self.err('P0001', 'bad_line')
    m['line'] = line; m['selections'] = _total_sel(self, m['turma_id'], m['metric'], line); m['edited_by'] = uid
    return self.ok({'line': line})
Fake.f_adjustPropLine = f_adjustPropLine
@_preg
def f_propEventBets(self, uid, eid):
    e = self.events.get(eid)
    if not e or not self._is_adm(e['turma_id'], uid): raise PermissionError('not_allowed')
    linked = _ev_linked(self, eid); rec = linked[-1]['created_by'] if linked else e['created_by']
    nm = lambda pid: (self.players.get(pid) or {}).get('name', '?')
    rows = []
    for b in self.pbets:
        m = self.pmk[b['market']]
        if m['event_id'] != eid: continue
        label = None
        if m['kind'] == 'duel': label = f"Duelo {nm(m['player_id'])} x {nm(m['player2_id'])} · {nm(b['selection'])}"
        elif m['kind'] == 'leader': label = {'goals': 'Artilheiro', 'assists': 'Garçom', 'saves': 'Paredão'}[m['metric']] + ' · ' + nm(b['selection'])
        elif m['kind'] == 'baba_total': label = ('Partidas no dia' if m['metric'] == 'matches' else 'Gols no dia') + ' · ' + ('Mais ' if b['selection'] == 'mais' else 'Menos ') + _fl(b.get('line') or m['line'])
        rows.append({'user_id': b['user'], 'name': self.profiles.get(b['user'], {}).get('name'), 'player': nm(m['player_id']) if m['player_id'] else None, 'metric': m['metric'], 'kind': m['kind'], 'line': b.get('line') or m['line'],
                     'selection': b['selection'], 'stake': b['stake'], 'odd': b['odd'], 'status': b['status'], 'payout': b['payout'], 'recorder': b['user'] == rec, 'label': label})
    return self.ok(rows)
def _season_of(d):
    d = str(d)[:10]; return d[:4] + ('-S1' if int(d[5:7]) <= 6 else '-S2')
@_preg
def f_propLeaderboard(self, uid, t, season=None):
    if not getattr(self, 'v115_enabled', False): raise LookupError()
    if not self.is_member(t, uid): raise PermissionError('not_member')
    cur = _season_of(_dt.date.today().isoformat()); s = season or cur
    agg = {}; seasons = {cur}
    for b in self.pbets:
        m = self.pmk[b['market']]; e = self.events.get(m['event_id'])
        if m['turma_id'] != t or b['status'] not in ('won', 'lost') or not e: continue
        es = _season_of(e['starts_at']); seasons.add(es)
        if es != s: continue
        a = agg.setdefault(b['user'], {'total': 0, 'wins': 0, 'staked': 0, 'paid': 0, 'cravadas': 0})
        a['total'] += 1; a['staked'] += b['stake']
        if b['status'] == 'won': a['wins'] += 1; a['paid'] += b['payout']; a['cravadas'] += m['kind'] == 'exact'
    rows = []
    for u, a in agg.items():
        if a['total'] < 10: continue
        lucro = a['paid'] - a['staked']
        rows.append({'user_id': u, 'name': self.profiles.get(u, {}).get('name', 'Alguém'), 'lucro': lucro, 'roi': round(lucro / a['staked'], 4) if a['staked'] else None,
                     'wins': a['wins'], 'total': a['total'], 'cravadas': a['cravadas'], 'me': u == uid})
    rows.sort(key=lambda r: (-r['lucro'], -(r['roi'] or 0), r['name']))
    for i, r in enumerate(rows): r['rank'] = i + 1
    me = agg.get(uid, {'total': 0})
    return self.ok({'turma_id': t, 'season': s, 'current': cur, 'seasons': sorted(seasons, reverse=True), 'min': 10, 'rows': rows,
                    'me': {'total': me['total'], 'qualified': me['total'] >= 10, 'need': 10, 'rank': next((r['rank'] for r in rows if r['me']), None)}})
@_preg
def f_userTrophies(self, uid, u=None):
    if not getattr(self, 'v115_enabled', False): raise LookupError()
    who = u or uid
    return self.ok([dict(x, turma=(self.turmas.get(x['turma_id']) or {}).get('name')) for x in getattr(self, 'trophies', [])
                    if x.get('scope') == 'atleta' and x.get('user_id') == who and self._can_see(x['turma_id'], uid)])

# ---- v11.6: baba compartilhado entre dono e adms (o banco de verdade é testado em supabase/test/v11_6_rules.sql)
# Liga por padrão; fake.v116_enabled = False simula o servidor antigo (o app volta a gravar direto na tabela).
def _v116(fn):
    def f(self, uid, *a):
        if not getattr(self, 'v116_enabled', True): return self.err('PGRST202', 'Could not find the function')
        if not uid: return self.err('P0001', 'not_authenticated')
        try: return fn(self, uid, *a)
        except PermissionError as e: return self.err('P0001', str(e))
    f.__name__ = fn.__name__; setattr(Fake, fn.__name__, f); return fn
def _org(self, t, u): return self.is_admin(t, u) or self.is_owner(t, u)
def _runs(self, b, u): return b.get('created_by') == u or any(_org(self, t, u) for t in (b.get('turma_ids') or []))
def _pname(self, u): return (self.profiles.get(u) or {}).get('name') or 'Alguém'
Fake._org = _org; Fake._runs = _runs; Fake._pname = _pname
def _bump(self, b, uid):
    b['rev'] = b.get('rev', 0) + 1; b['updated_by'] = uid; b['updated'] = next(self.seq)
    if not b.get('started_by') and (b.get('state') or {}).get('firstKickoffAt'): b['started_by'] = uid
Fake._bump = _bump
@_v116
def f_saveBaba(self, uid, row, base_rev=None):
    ids = list(row.get('turma_ids') or [])
    if not all(self.is_member(t, uid) for t in ids): raise PermissionError('not_member')
    b = self.babas.get(row['id'])
    if not b:
        b = {'id': row['id'], 'created_by': uid, 'turma_ids': ids, 'title': row.get('title'), 'played_on': row.get('played_on'), 'state': row['state'], 'finished': False,
             'matches': row.get('matches') or 0, 'event_id': row.get('event_id'), 'rev': 0}
        self.babas[row['id']] = b; self._bump(b, uid)
        return self.ok({'rev': b['rev'], 'updated_by': uid, 'conflict': False})
    if b['finished']: return self.ok({'finished': True, 'rev': b['rev'], 'finished_by': b.get('finished_by'), 'finished_by_name': self._pname(b.get('finished_by'))})
    if not self._runs(b, uid): raise PermissionError('forbidden')
    if b['created_by'] != uid and not self._runs(dict(b, turma_ids=ids), uid): ids = b['turma_ids']
    prev = b.get('rev', 0)
    b.update({'state': row['state'], 'turma_ids': ids, 'title': row.get('title') or b.get('title'), 'played_on': row.get('played_on') or b.get('played_on'),
              'matches': row.get('matches', b.get('matches')), 'event_id': row.get('event_id') or b.get('event_id')})
    self._bump(b, uid)
    return self.ok({'rev': b['rev'], 'updated_by': uid, 'conflict': base_rev is not None and base_rev < prev})
@_v116
def f_finishBaba(self, uid, row, stats):
    self.finish_calls = getattr(self, 'finish_calls', 0) + 1
    b = self.babas.get(row['id'])
    if b and b['finished']: return self.ok({'already': True, 'finished_by': b.get('finished_by'), 'finished_by_name': self._pname(b.get('finished_by'))})
    if not b:
        if not all(self.is_member(t, uid) for t in (row.get('turma_ids') or [])): raise PermissionError('not_member')
        b = {'id': row['id'], 'created_by': uid, 'turma_ids': list(row.get('turma_ids') or []), 'rev': 0, 'state': {}}
        self.babas[row['id']] = b
    elif not self._runs(b, uid): raise PermissionError('forbidden')
    b.update({'finished': True, 'finished_by': uid, 'state': row.get('state') or b.get('state'), 'title': row.get('title') or b.get('title'),
              'played_on': row.get('played_on') or b.get('played_on'), 'matches': row.get('matches', b.get('matches')), 'event_id': row.get('event_id') or b.get('event_id')})
    self._bump(b, uid)
    self.finished_reports = getattr(self, 'finished_reports', 0) + 1
    self.stats[b['id']] = [dict(r, id=next(self.seq) + 1000) for r in (stats or [])]
    if hasattr(self, 'pmk') and b.get('event_id') and b['event_id'] in getattr(self, 'events', {}): self._p_settle(b['event_id'])
    return self.ok({'ok': True, 'finished_by': uid, 'finished_by_name': self._pname(uid)})
@_v116
def f_babaRev(self, uid, bid):
    b = self.babas.get(bid)
    if not b: return self.ok({'gone': True})
    if not self._runs(b, uid): raise PermissionError('forbidden')
    return self.ok({'rev': b.get('rev', 0), 'updated_by': b.get('updated_by'), 'updated_by_name': self._pname(b.get('updated_by')), 'finished': b['finished'],
                    'finished_by': b.get('finished_by'), 'finished_by_name': self._pname(b.get('finished_by')) if b['finished'] else None})
@_v116
def f_babaGet(self, uid, bid):
    b = self.babas.get(bid)
    if not b: return self.ok(None)
    if not self._runs(b, uid): raise PermissionError('forbidden')
    return self.ok({'id': b['id'], 'state': b.get('state'), 'rev': b.get('rev', 0), 'created_by': b['created_by'], 'turma_ids': b.get('turma_ids'), 'title': b.get('title'),
                    'played_on': b.get('played_on'), 'finished': b['finished'], 'updated_by': b.get('updated_by'), 'updated_by_name': self._pname(b.get('updated_by')),
                    'started_by': b.get('started_by'), 'started_by_name': self._pname(b.get('started_by')) if b.get('started_by') else None,
                    'finished_by_name': self._pname(b.get('finished_by')) if b['finished'] else None})
@_v116
def f_babasShared(self, uid):
    out = []
    for b in sorted(self.babas.values(), key=lambda x: x.get('updated', 0), reverse=True):
        if b['finished'] or not self._runs(b, uid): continue
        st = b.get('state') or {}; hist = st.get('matchHistory') or []; m = st.get('match') or {}; court = st.get('court') or {}
        goals = sum((h.get('scoreA') or 0) + (h.get('scoreB') or 0) for h in hist) + (m.get('scoreA') or 0) + (m.get('scoreB') or 0)
        live = bool(m.get('isRunning') or (m.get('scoreA') or 0) + (m.get('scoreB') or 0) > 0 or m.get('events')) and isinstance(court.get('A'), dict) and isinstance(court.get('B'), dict)
        out.append({'id': b['id'], 'title': b.get('title'), 'played_on': b.get('played_on'), 'created_by': b['created_by'], 'turma_ids': b.get('turma_ids') or [], 'rev': b.get('rev', 0),
                    'started_by': b.get('started_by'), 'started_by_name': self._pname(b.get('started_by')) if b.get('started_by') else None,
                    'started': bool(st.get('firstKickoffAt')), 'matches': len(hist), 'goals': goals, 'live_match': live})
    return self.ok(out[:20])

# ---- v11.6.1: anotador único e mesário (o banco de verdade é testado em supabase/test/v11_6_1_rules.sql)
# fake.v1161_enabled = False simula o servidor só com a v11.6 (lances voltam a ser gravados no celular).
import copy as _copy
def _hist(st): return len((st or {}).get('matchHistory') or [])
def _keep_counters(inc, srv):
    sp = {str(p.get('id')): p for p in (srv or {}).get('players') or []}
    out = _copy.deepcopy(inc)
    for p in out.get('players') or []:
        s = sp.get(str(p.get('id'))) or {}
        for k in ('goals', 'assists', 'saves'): p[k] = s.get(k, 0) or 0
    return out
def _keep_match(inc, srv):
    out = _copy.deepcopy(inc); m = out.setdefault('match', {}); s = (srv or {}).get('match') or {}
    d = (s.get('addedSeconds') or 0) - (m.get('addedSeconds') or 0)
    m.update({'events': _copy.deepcopy(s.get('events') or []), 'scoreA': s.get('scoreA') or 0, 'scoreB': s.get('scoreB') or 0, 'addedSeconds': s.get('addedSeconds') or 0})
    if d:
        m['secondsLeft'] = max(0, (m.get('secondsLeft') or 0) + d)
        if isinstance(m.get('endAt'), (int, float)): m['endAt'] += d * 1000
    return out
def _guard(inc, srv, org, scorer, cli, seq):
    if not srv: return inc
    if cli is None and scorer and org: return inc
    hin, hsv = _hist(inc), _hist(srv); fresh = cli is None or cli >= seq
    if hin == hsv + 1:
        h0 = inc['matchHistory'][0]; sm = srv.get('match') or {}
        if not fresh or (h0.get('scoreA') or 0) != (sm.get('scoreA') or 0) or (h0.get('scoreB') or 0) != (sm.get('scoreB') or 0): raise PermissionError('stale_lances')
    elif hin != hsv and (not fresh or not org): raise PermissionError('stale_lances')
    if not org:
        if hin == hsv + 1:
            out = _copy.deepcopy(inc)
            for k in ('settings', 'selectedTeams', 'startedAt', 'eventId', 'arrivalSeq', 'live', 'liveAsked'):
                if k in srv: out[k] = _copy.deepcopy(srv[k])
                else: out.pop(k, None)
            ip = {str(p.get('id')): p for p in inc.get('players') or []}
            out['players'] = [dict(s, **{k: (ip.get(str(s.get('id'))) or s).get(k, 0) for k in ('matches', 'wins', 'penGoals', 'penMisses', 'penSaves')}) for s in srv.get('players') or []]
            out['match'] = dict(out.get('match') or {}, events=[], scoreA=0, scoreB=0)
        else:
            out = _copy.deepcopy(srv); m = out.setdefault('match', {})
            for k in ('isRunning', 'endAt', 'secondsLeft', 'initialSeconds'):
                if k in (inc.get('match') or {}): m[k] = inc['match'][k]
            if not srv.get('firstKickoffAt') and inc.get('firstKickoffAt'): out['firstKickoffAt'] = inc['firstKickoffAt']
            out = _keep_match(out, srv)
    elif hin == hsv:
        c = inc.get('court') or {}; m = inc.get('match') or {}
        if (not isinstance(c.get('A'), dict) or not isinstance(c.get('B'), dict)) and not m.get('events') and not m.get('scoreA') and not m.get('scoreB'): out = inc
        else: out = _keep_match(inc, srv)
    elif hin < hsv: return inc
    else:
        out = _copy.deepcopy(inc); out['match'] = dict(out.get('match') or {}, events=[], scoreA=0, scoreB=0)
    return _keep_counters(out, srv)
def _roles(self, b, uid):
    return {'scorer_id': b.get('scorer_id'), 'scorer_name': self._pname(b.get('scorer_id')) if b.get('scorer_id') else None,
            'mesario_id': b.get('mesario_id'), 'mesario_name': self._pname(b.get('mesario_id')) if b.get('mesario_id') else None,
            'lance_seq': b.get('lance_seq', 0), 'my_role': 'org' if self._runs(b, uid) else 'mesario' if uid == b.get('mesario_id') else 'viewer'}
def _sees(self, b, uid): return self._runs(b, uid) or uid == b.get('mesario_id') or uid in (b.get('scorers') or [])
Fake._roles = _roles; Fake._sees = _sees
_bump_116 = Fake._bump
def _bump_1161(self, b, uid):
    _bump_116(self, b, uid)
    if not b.get('finished') and b.get('started_by') and not b.get('scorer_id'):
        b['scorer_id'] = b['started_by']; b.setdefault('scorers', [])
        if b['started_by'] not in b['scorers']: b['scorers'].append(b['started_by'])
    if b.get('finished'): b['mesario_id'] = None
Fake._bump = _bump_1161
def _v1161(fn):
    def f(self, uid, *a):
        if not getattr(self, 'v116_enabled', True) or not getattr(self, 'v1161_enabled', True): return self.err('PGRST202', 'Could not find the function')
        if not uid: return self.err('P0001', 'not_authenticated')
        try: return fn(self, uid, *a)
        except PermissionError as e: return self.err('P0001', str(e))
    f.__name__ = fn.__name__; setattr(Fake, fn.__name__, f); return fn
_save_116 = Fake.f_saveBaba
def f_saveBaba_1161(self, uid, row, base_rev=None, lance_seq=None):
    if not getattr(self, 'v1161_enabled', True): return _save_116(self, uid, row, base_rev)
    if not getattr(self, 'v116_enabled', True): return self.err('PGRST202', 'Could not find the function')
    if not uid: return self.err('P0001', 'not_authenticated')
    b = self.babas.get(row['id'])
    if not b or b.get('finished'): return _save_116(self, uid, row, base_rev)
    org = self._runs(b, uid)
    if not org and uid != b.get('mesario_id'): return self.err('P0001', 'forbidden')
    try: st = _guard(row['state'], b.get('state'), org, uid == b.get('scorer_id'), lance_seq, b.get('lance_seq', 0))
    except PermissionError as e: return self.err('P0001', str(e))
    prev = b.get('rev', 0)
    if org:
        r = _save_116(self, uid, dict(row, state=st), base_rev)
        if 'err' in r: return r
    else:
        b['state'] = st; self._bump(b, uid)
    b['matches'] = _hist(st)
    return self.ok({'rev': b['rev'], 'updated_by': uid, 'conflict': base_rev is not None and base_rev < prev, 'lance_seq': b.get('lance_seq', 0), 'merged': st != row['state']})
Fake.f_saveBaba = f_saveBaba_1161
for _n in ('f_babaRev', 'f_babaGet'):
    def _mk(orig):
        def g(self, uid, bid):
            b = self.babas.get(bid)
            if b and getattr(self, 'v1161_enabled', True) and not self._runs(b, uid) and self._sees(b, uid):
                saved = b['created_by']; b['created_by'] = uid
                try: r = orig(self, uid, bid)
                finally: b['created_by'] = saved
                if 'data' in r and r['data'] and 'created_by' in r['data']: r['data']['created_by'] = saved
            else: r = orig(self, uid, bid)
            if b and 'data' in r and r['data'] and getattr(self, 'v1161_enabled', True): r['data'].update(self._roles(b, uid))
            return r
        return g
    setattr(Fake, _n, _mk(getattr(Fake, _n)))
_shared_116 = Fake.f_babasShared
def f_babasShared_1161(self, uid):
    r = _shared_116(self, uid)
    if 'err' in r or not getattr(self, 'v1161_enabled', True): return r
    rows = r['data']
    for x in rows: x['my_role'] = 'org'; x['scorer_id'] = self.babas[x['id']].get('scorer_id')
    for b in sorted(self.babas.values(), key=lambda x: x.get('updated', 0), reverse=True):
        if not b['finished'] and b.get('mesario_id') == uid and not self._runs(b, uid):
            rows.append({'id': b['id'], 'title': b.get('title'), 'played_on': b.get('played_on'), 'created_by': b['created_by'], 'turma_ids': b.get('turma_ids') or [],
                         'rev': b.get('rev', 0), 'started': bool((b.get('state') or {}).get('firstKickoffAt')), 'matches': _hist(b.get('state')), 'goals': 0,
                         'live_match': False, 'my_role': 'mesario', 'scorer_id': b.get('scorer_id')})
    return self.ok(rows)
Fake.f_babasShared = f_babasShared_1161
def _bump_player(st, pid, field, delta):
    for p in st.get('players') or []:
        if pid is not None and str(p.get('id')) == str(pid): p[field] = max(0, (p.get(field) or 0) + delta)
@_v1161
def f_lanceBaba(self, uid, bid, l):
    self.lance_log = getattr(self, 'lance_log', [])
    b = self.babas.get(bid)
    if not b: raise PermissionError('not_found')
    if any(x['lid'] == l.get('lid') for x in self.lance_log): return self.ok({'dup': True, 'rev': b['rev'], 'lance_seq': b.get('lance_seq', 0)})
    if b['finished']: raise PermissionError('finished')
    org = self._runs(b, uid); kind = l.get('kind')
    ok = uid == b.get('scorer_id') or (not b.get('scorer_id') and org)
    if not (ok or (kind == 'extra' and org)): raise PermissionError('not_scorer')
    if not b.get('scorer_id') and org: b['scorer_id'] = uid; b.setdefault('scorers', []).append(uid)
    st = _copy.deepcopy(b.get('state') or {}); mno = _hist(st) + 1
    if l.get('match_no', mno) != mno: raise PermissionError('stale_match')
    m = st.setdefault('match', {}); ev = m.setdefault('events', [])
    side = 'B' if l.get('side') == 'B' else 'A'
    if kind == 'goal':
        if not isinstance((st.get('court') or {}).get(side), dict): raise PermissionError('no_court')
        m['score' + side] = (m.get('score' + side) or 0) + 1
        _bump_player(st, l.get('scorerId'), 'goals', 1)
        if l.get('assistId') != l.get('scorerId'): _bump_player(st, l.get('assistId'), 'assists', 1)
        ev.insert(0, {'lid': l['lid'], 'type': 'goal', 'side': side, 'el': l.get('el') or 0, 'scorerId': l.get('scorerId'), 'assistId': l.get('assistId'), 'time': l.get('time'), 'text': l.get('text')})
    elif kind == 'save':
        _bump_player(st, l.get('keeperId'), 'saves', 1)
        ev.insert(0, {'lid': l['lid'], 'type': 'save', 'side': side, 'el': l.get('el') or 0, 'keeperId': l.get('keeperId'), 'time': l.get('time'), 'text': l.get('text')})
    elif kind == 'extra':
        s = l.get('seconds') or 0
        m['addedSeconds'] = (m.get('addedSeconds') or 0) + s; m['secondsLeft'] = (m.get('secondsLeft') or 0) + s
        if m.get('isRunning') and isinstance(m.get('endAt'), (int, float)): m['endAt'] += s * 1000
        ev.insert(0, {'lid': l['lid'], 'type': 'extra', 'seconds': s, 'time': l.get('time'), 'text': l.get('text')})
    else:
        if not ev: raise PermissionError('nothing_to_undo')
        f0 = ev[0]
        if f0.get('lid') != l.get('target'): raise PermissionError('not_last')
        if f0['type'] == 'goal':
            sd = f0['side']; m['score' + sd] = max(0, (m.get('score' + sd) or 0) - 1)
            _bump_player(st, f0.get('scorerId'), 'goals', -1)
            if f0.get('assistId') != f0.get('scorerId'): _bump_player(st, f0.get('assistId'), 'assists', -1)
        elif f0['type'] == 'save': _bump_player(st, f0.get('keeperId'), 'saves', -1)
        elif f0['type'] == 'extra':
            s = min(f0.get('seconds') or 0, m.get('addedSeconds') or 0)
            m['addedSeconds'] = (m.get('addedSeconds') or 0) - s; m['secondsLeft'] = max(0, (m.get('secondsLeft') or 0) - s)
            if m.get('isRunning') and isinstance(m.get('endAt'), (int, float)):
                m['endAt'] -= s * 1000
                if m['secondsLeft'] == 0: m['isRunning'] = False; m['endAt'] = None
        ev.pop(0)
    b['state'] = st; b['lance_seq'] = b.get('lance_seq', 0) + 1; self._bump(b, uid)
    self.lance_log.append({'lid': l['lid'], 'baba': bid, 'by': uid, 'kind': kind})
    return self.ok({'ok': True, 'rev': b['rev'], 'lance_seq': b['lance_seq']})
def _live_follow(self, b, uid):
    lv = (b.get('state') or {}).get('live') or {}
    g = getattr(self, 'lives', {}).get(lv.get('id'))
    if g and g.get('active'): g['owner'] = uid
    if lv: b['state']['live']['owner'] = uid
Fake._live_follow = _live_follow
@_v1161
def f_takeScoring(self, uid, bid):
    b = self.babas.get(bid)
    if not b: raise PermissionError('not_found')
    if b['finished']: raise PermissionError('finished')
    if not self._runs(b, uid): raise PermissionError('forbidden')
    b['scorer_id'] = uid; b['mesario_id'] = None; b.setdefault('scorers', [])
    if uid not in b['scorers']: b['scorers'].append(uid)
    self._live_follow(b, uid); self._bump(b, uid)
    return self.ok({'ok': True, 'rev': b['rev'], 'scorer_id': uid, 'scorer_name': self._pname(uid)})
@_v1161
def f_setMesario(self, uid, bid, user):
    b = self.babas.get(bid)
    if not b: raise PermissionError('not_found')
    if b['finished']: raise PermissionError('finished')
    if not self._runs(b, uid): raise PermissionError('forbidden')
    ok = False
    for p in (b.get('state') or {}).get('players') or []:
        if not p.get('present'): continue
        tp = next((x for x in self.players.values() if x['turma_id'] == p.get('turmaId') and x['name'].lower() == str(p.get('name')).lower()), None)
        if tp and tp.get('user_id') == user and tp['turma_id'] in (b.get('turma_ids') or []) and self.is_member(tp['turma_id'], user): ok = True
    if not ok: raise PermissionError('not_present')
    org_t = self._runs(b, user)
    b['scorer_id'] = user; b['mesario_id'] = None if org_t else user; b.setdefault('scorers', [])
    if user not in b['scorers']: b['scorers'].append(user)
    self._live_follow(b, user); self._bump(b, uid)
    return self.ok({'ok': True, 'rev': b['rev'], 'scorer_id': user, 'scorer_name': self._pname(user), 'mesario': not org_t})


# --- v11.7 · corrigir/excluir baba anterior e renomear atleta (dono/adm no servidor)
def _org_any(self, b, uid):
    return any(self.is_admin(t, uid) or self.is_owner(t, uid) for t in (b.get('turma_ids') or []))
@_reg
def f_editBaba(self, uid, bid, played_on, venue, scores, stats):
    b = self.babas.get(bid)
    if not b: return self.err('P0001', 'not_found')
    if not b['finished']: return self.err('P0001', 'not_finished')
    if not _org_any(self, b, uid): return self.err('P0001', 'forbidden')
    if venue not in (None, '', 'campo', 'society', 'futsal'): return self.err('P0001', 'invalid_venue')
    st = b.setdefault('state', {})
    if venue is not None: st['venue'] = venue
    if played_on: b['played_on'] = played_on
    for x in scores or []:
        games = st.get('games') or []
        if 0 <= x['i'] < len(games):
            games[x['i']]['scoreA'] = x['a']; games[x['i']]['scoreB'] = x['b']
            if x['a'] != x['b']: games[x['i']].pop('pens', None)
    for x in stats or []:
        for r in self.stats.get(bid, []):
            if r.get('id') == x['id']:
                for k in ('goals', 'assists', 'saves'):
                    if k in x and x[k] is not None: r[k] = x[k]
    self.edit_calls = getattr(self, 'edit_calls', 0) + 1
    self._bump(b, uid)
    return self.ok({'ok': True})
@_reg
def f_removeBaba(self, uid, bid):
    b = self.babas.get(bid)
    if not b: return self.ok({'ok': True, 'gone': True})
    if not b['finished']: return self.err('P0001', 'not_finished')
    if not _org_any(self, b, uid): return self.err('P0001', 'forbidden')
    del self.babas[bid]; self.stats.pop(bid, None)
    self.remove_calls = getattr(self, 'remove_calls', 0) + 1
    return self.ok({'ok': True})
@_reg
def f_renamePlayerById(self, uid, pid, name):
    p = self.players.get(pid)
    if not p: return self.err('P0001', 'not_found')
    if not (self.is_admin(p['turma_id'], uid) or self.is_owner(p['turma_id'], uid)): return self.err('P0001', 'forbidden')
    name = ' '.join((name or '').split())
    if not name: return self.err('P0001', 'name_empty')
    if any(q['turma_id'] == p['turma_id'] and q['id'] != pid and q['name'].lower() == name.lower() for q in self.players.values()): return self.err('P0001', 'name_taken')
    old = p['name']; p['name'] = name
    for bid, rows in self.stats.items():
        for r in rows:
            if r.get('turma_player_id') == pid or (r.get('turma_player_id') is None and r['name'].lower() == old.lower()): r['name'] = name; r['turma_player_id'] = pid
    return self.ok({'ok': True, 'name': name})
