window.__BABA_FAKE_API__ = (() => {
  const call = async (name, args) => {
    const s = JSON.parse(localStorage.getItem('fake_session') || 'null');
    const r = await window.fakeCall(name, s ? s.access_token : null, args);
    if (r && r.err) { const e = new Error(r.err.message || r.err.code || 'err'); Object.assign(e, r.err); throw e; }
    return r ? r.data : null;
  };
  const setS = s => s ? localStorage.setItem('fake_session', JSON.stringify(s)) : localStorage.removeItem('fake_session');
  const m = n => (...a) => call(n, a);
  return {
    enabled: () => true,
    signup: m('signup'), reset: m('reset'), newCode: m('newCode'), deleteAccount: m('deleteAccount'),
    async signIn(e, p) { const s = await call('signIn', [e, p]); setS(s); return s; },
    async signOut() { setS(null); },
    async getSession() { return JSON.parse(localStorage.getItem('fake_session') || 'null'); },
    updatePassword: m('updatePassword'), memberships: m('memberships'), players: m('players'), openBaba: m('openBaba'),
    finishedBabas: m('finishedBabas'), turmaOpenBabas: m('turmaOpenBabas'), profile: m('profile'), upsertBaba: m('upsertBaba'), deleteBaba: m('deleteBaba'),
    replaceStats: m('replaceStats'), upsertTurma: m('upsertTurma'), turmaInvite: m('turmaInvite'), setInvite: m('setInvite'),
    deleteTurma: m('deleteTurma'), leaveTurma: m('leaveTurma'), insertPlayers: m('insertPlayers'), deletePlayers: m('deletePlayers'),
    setKeeper: m('setKeeper'), setFemale: m('setFemale'), renamePlayer: m('renamePlayer'), join: m('join'), claim: m('claim'), unclaim: m('unclaim'),
    updateProfile: m('updateProfile'), signOutOthers: m('signOutOthers'), roster: m('roster'), setRole: m('setRole'), transfer: m('transfer'), removeMember: m('removeMember'),
    myAccount: m('myAccount'), acceptTerms: m('acceptTerms'), myWallet: m('myWallet'), claimDaily: m('claimDaily'), shopItems: m('shopItems'), ledger: m('ledger'),
    buyItem: m('buyItem'), equipItem: m('equipItem'), createLive: m('createLive'), updateLive: m('updateLive'), liveList: m('liveList'), getLive: m('getLive'),
    placePalpite: m('placePalpite'), myPalpites: m('myPalpites'), settlePalpites: m('settlePalpites'), liveRanking: m('liveRanking'),
    chatList: m('chatList'), chatSend: m('chatSend'), chatDelete: m('chatDelete'), chatReport: m('chatReport'), liveChat: m('liveChat'), peopleCards: m('peopleCards'),
    myStatus: m('myStatus'), pingActivity: m('pingActivity'), myMissions: m('myMissions'), claimMission: m('claimMission'),
    challengeCandidates: m('challengeCandidates'), createChallenge: m('createChallenge'), respondChallenge: m('respondChallenge'), cancelChallenge: m('cancelChallenge'), myChallenges: m('myChallenges'),
    throwPipoca: m('throwPipoca'), setNickname: m('setNickname'), savePush: m('savePush'), dropPush: m('dropPush'), pushStatus: m('pushStatus'), livePush: m('livePush')
  };
})();
