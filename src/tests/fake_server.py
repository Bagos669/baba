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
        return self.ok([{'id': b['id'], 'title': b['title'], 'played_on': b['played_on'], 'matches': b['matches'], 'created_by': b['created_by'],
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
