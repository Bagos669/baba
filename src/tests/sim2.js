// Runs inside the page. Returns a report of invariant violations and observations.
async function runSims() {
  const report = { violations: [], notes: [] };
  window.askConfirm = async () => true;            // auto-accept dialogs
  let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const pick = arr => arr[Math.floor(rnd() * arr.length)];

  function check(tag) {
    const s = state;
    const ids = s.players.map(p => p.id);
    if (new Set(ids).size !== ids.length) report.violations.push(`${tag}: duplicate player ids`);
    const names = s.players.map(p => p.name.toLowerCase());
    if (new Set(names).size !== names.length) report.violations.push(`${tag}: duplicate names`);
    const where = new Map();
    const put = (id, w) => { if (where.has(id)) report.violations.push(`${tag}: ${nameOf(id)} in ${where.get(id)} and ${w}`); where.set(id, w); };
    ['A', 'B'].forEach(side => { const t = s.court[side]; if (t) t.ids.forEach(id => put(id, side)); });
    s.queue.forEach(id => put(id, 'queue'));
    s.players.forEach(p => {
      if (p.present && !where.has(p.id)) report.violations.push(`${tag}: present ${p.name} is nowhere`);
      if (!p.present && where.has(p.id)) report.violations.push(`${tag}: absent ${p.name} is in ${where.get(p.id)}`);
    });
    where.forEach((w, id) => { if (!byId(id)) report.violations.push(`${tag}: unknown id ${id} in ${w}`); });
    if (s.court.A && s.court.B && s.court.A.label === s.court.B.label) report.violations.push(`${tag}: same label on both sides`);
    const histPlayers = s.matchHistory.reduce((n, h) => n + h.namesA.length + h.namesB.length, 0);
    const matches = s.players.reduce((n, p) => n + (p.matches || 0), 0);
    if (histPlayers !== matches) report.violations.push(`${tag}: matches ${matches} != history appearances ${histPlayers}`);
    const stM = Object.values(s.standings).reduce((n, st) => n + st.matches, 0);
    if (stM !== 2 * s.matchHistory.length) report.violations.push(`${tag}: standings matches ${stM} != ${2 * s.matchHistory.length}`);
    const goals = s.players.reduce((n, p) => n + (p.goals || 0), 0);
    const scored = s.matchHistory.reduce((n, h) => n + h.scoreA + h.scoreB, 0) + s.match.scoreA + s.match.scoreB;
    if (goals !== scored) report.violations.push(`${tag}: goals ${goals} != scoreboard total ${scored}`);
    // DOM renders without throwing
    try { renderAllComponents(); } catch (e) { report.violations.push(`${tag}: render threw ${e.message}`); }
  }

  function goal(side, withAssist = true) {
    const t = state.court[side]; if (!t) return;
    selectedGoalSide = side; selectedGoalScorer = pick(t.ids);
    const others = t.ids.filter(id => id !== selectedGoalScorer);
    confirmGoalRecord(withAssist && others.length && rnd() < 0.6 ? pick(others) : null);
  }
  async function playMatch(maxGoals = 4) {
    const n = Math.floor(rnd() * maxGoals);
    for (let i = 0; i < n; i++) goal(rnd() < 0.5 ? 'A' : 'B');
    if (rnd() < 0.3) { selectedSaveSide = pick(['A', 'B']); recordGoalkeeperSave(pick(state.court[selectedSaveSide].ids)); }
    await finishMatchAndNextChallenger(true);
  }

  // ---------- Scenario 1: a full morning ----------
  localStorage.clear(); state = defaultState(); state.match.goalLimitRule = 'none';
  state.selectedTeams = ['fiasco', 'robson']; syncPool(); check('s1 sync');
  if (state.players.length !== 21) report.violations.push(`s1: expected 21 players, got ${state.players.length}`);
  ['Lani Ramos', 'Olavo', 'Diego'].forEach(n => togglePlayerPos(state.players.find(p => p.name === n).id));
  const arrivalOrder = [...state.players];
  const early = arrivalOrder.slice(0, 12), late = arrivalOrder.slice(12);
  early.forEach(p => checkIn(p.id)); check('s1 early checkins');
  buildTeams(); check('s1 build');
  const keepersPerTeam = ['A', 'B'].map(s => state.court[s].ids.filter(id => byId(id).isGoalkeeper).length);
  report.notes.push(`s1 first teams keepers: ${keepersPerTeam.join(',')} (sizes ${state.court.A.ids.length},${state.court.B.ids.length}), queue ${state.queue.length}`);
  for (let m = 0; m < 6; m++) { await playMatch(); check(`s1 match ${m}`); }
  late.forEach(p => checkIn(p.id)); check('s1 late checkins');
  for (let m = 6; m < 22; m++) {
    await playMatch(); check(`s1 match ${m}`);
    if (m === 9) { // substitution: tired player swaps with queue
      const out = state.court.A.ids[0], inn = state.queue[2]; openSubModal('A', out); setSubDest('swap'); applySub(inn); check('s1 sub swap');
      if (state.queue[2] !== out || !state.court.A.ids.includes(inn)) report.violations.push('s1: swap did not exchange places');
    }
    if (m === 11) { const out = state.court.B.ids[1]; openSubModal('B', out); setSubDest('out'); applySub(state.queue[0]); check('s1 sub injured');
      if (byId(out).present) report.violations.push('s1: injured player still present'); }
    if (m === 13) { const out = state.court.B.ids[0]; openSubModal('B', out); setSubDest('end'); applySub(null); check('s1 sub nobody');
      completeTeam('B'); check('s1 complete'); }
    if (m === 15) { moveQueue(3, -1); moveQueue(0, -1); moveQueue(state.queue.length - 1, 1); check('s1 queue moves'); }
    if (m === 17) { const leaver = state.queue[1]; await togglePlayerAttendance(leaver); check('s1 leave from queue');
      await togglePlayerAttendance(leaver); check('s1 return');
      if (state.queue[state.queue.length - 1] !== leaver) report.violations.push('s1: returning player not at end of queue'); }
    if (m === 19) { const onCourt = state.court.A.ids[2]; await togglePlayerAttendance(onCourt); check('s1 leave from court'); }
  }
  // fairness: early arrivals should have played at least as much as late ones on average
  const avg = arr => arr.reduce((n, p) => n + (byId(p.id) ? byId(p.id).matches : 0), 0) / arr.length;
  report.notes.push(`s1 avg matches early(${early.length})=${avg(early).toFixed(2)} late(${late.length})=${avg(late).toFixed(2)}; total matches ${state.matchHistory.length}; labels used ${state.teamSeq}`);
  if (avg(early) < avg(late)) report.violations.push('s1: late arrivals played more than early ones');

  // undo finish restores exactly
  const before = JSON.stringify({ q: state.queue, c: state.court, h: state.matchHistory.length });
  goal('A'); await finishMatchAndNextChallenger(true); await undoFinish(); check('s1 undo finish');
  const after = JSON.stringify({ q: state.queue, c: state.court, h: state.matchHistory.length });
  if (before !== after) report.violations.push('s1: undo finish did not restore court/queue/history');
  if (state.match.scoreA !== 1) report.violations.push('s1: undo finish lost the scoreboard');
  undoLastEvent(); check('s1 undo goal');

  // reload from storage mid-day
  saveState(); const snap = JSON.stringify(state); loadState();
  if (JSON.stringify(state) !== snap) report.violations.push('s1: reload changed state');
  check('s1 reload');

  // ---------- Scenario 2: rules (draw both, max streak 2) ----------
  updateSetting('drawRule', 'both'); updateSetting('maxStreak', 2);
  const A0 = state.court.A, B0 = state.court.B;
  await finishMatchAndNextChallenger(true); check('s2 draw both');
  if (state.court.A.ids.some(id => A0.ids.includes(id) || B0.ids.includes(id)) && state.queue.length >= 10) report.violations.push('s2: draw-both kept a player on court');
  goal('A'); await finishMatchAndNextChallenger(true); // A wins (streak 1)
  const king = state.court.A; goal('A'); await finishMatchAndNextChallenger(true); check('s2 streak');
  if (state.court.A.label === king.label) report.violations.push('s2: king stayed after reaching max streak');
  updateSetting('drawRule', 'king'); updateSetting('maxStreak', 0);
  const kingA = state.court.A.label, chalB = state.court.B.label;
  await finishMatchAndNextChallenger(true); check('s2 draw king');
  if (state.court.A.label !== chalB) report.violations.push('s2: on draw the challenger should stay as A');

  // ---------- Scenario 3: turmas editing ----------
  createTurma(); renameTurma('Pelada Quinta'); 
  document.getElementById('turma-edit-add').value = 'Zé\nTonho, Bira; Zé'; addMembersFromInput();
  const t3 = state.turmas.find(t => t.name === 'Pelada Quinta');
  if (!t3 || t3.players.length !== 3) report.violations.push(`s3: expected 3 members, got ${t3 && t3.players.length}`);
  toggleTurmaKeeper(1); await removeTurmaMember(0); closeTurmaEditor();
  document.querySelectorAll('#db-checkboxes-container input').forEach(cb => { if (cb.value === t3.id) cb.checked = true; });
  applyDatabaseSelection(); check('s3 select new turma');
  const tonho = state.players.find(p => p.name === 'Tonho');
  if (!tonho || !tonho.isGoalkeeper) report.violations.push('s3: turma goalkeeper flag not applied');
  if (state.players.some(p => p.name === 'Zé')) report.violations.push('s3: removed member still in pool');
  // edit an official turma: remove an absent member and a present one
  openTurmaEditor('robson'); const rb = turmaById('robson');
  const absentIdx = rb.players.findIndex(n => { const p = state.players.find(x => sameName(x.name, n)); return p && !p.present && !hasStats(p); });
  const presentIdx = rb.players.findIndex(n => { const p = state.players.find(x => sameName(x.name, n)); return p && p.present; });
  const absentName = absentIdx >= 0 ? rb.players[absentIdx] : null, presentName = rb.players[presentIdx];
  if (absentIdx >= 0) await removeTurmaMember(absentIdx);
  await removeTurmaMember(rb.players.indexOf(presentName)); closeTurmaEditor(); check('s3 edit official');
  if (absentName && state.players.some(p => p.name === absentName)) report.violations.push('s3: removed absent member still in pool');
  if (!state.players.some(p => p.name === presentName)) report.violations.push('s3: present member dropped from today');
  // delete a turma that is selected
  openTurmaEditor(t3.id); await deleteTurma(); check('s3 delete turma');

  // ---------- Scenario 4: add / rename / delete players ----------
  openAddPlayerModal(); document.getElementById('input-new-player-name').value = 'Convidado Silva'; saveNewPlayer(); check('s4 add');
  const cs = state.players.find(p => p.name === 'Convidado Silva');
  if (!cs || !cs.present || state.queue[state.queue.length - 1] !== cs.id) report.violations.push('s4: new arrived player not at end of queue');
  openAddPlayerModal(); document.getElementById('input-new-player-name').value = 'convidado silva'; saveNewPlayer();
  if (state.players.filter(p => sameName(p.name, 'convidado silva')).length !== 1) report.violations.push('s4: duplicate name accepted');
  const gm = state.players.find(p => p.name === 'Gabriel Marini');
  openPlayerSheet(gm.id); document.getElementById('player-edit-name').value = 'Gabriel "Capita" Marini'; savePlayerSheet(); check('s4 rename');
  if (!turmaById('fiasco').players.includes('Gabriel "Capita" Marini')) report.violations.push('s4: rename not propagated to turma');
  openPlayerSheet(cs.id); await deletePlayerFromSheet(); check('s4 delete avulso');

  // ---------- Scenario 5: format change and tiny groups ----------
  updateKeeperMode('time'); updateGameFormat(7); await finishMatchAndNextChallenger(true); check('s5 society');
  report.notes.push(`s5 after society: sizes ${state.court.A.ids.length}/${state.court.B ? state.court.B.ids.length : 0}, queue ${state.queue.length}`);
  updateGameFormat(4);
  // exactly 2 teams' worth: labels should be reused, not grow forever
  localStorage.clear(); state = defaultState(); state.match.goalLimitRule = 'none';
  state.selectedTeams = ['fiasco']; syncPool(); state.players.slice(0, 10).forEach(p => checkIn(p.id)); buildTeams();
  for (let m = 0; m < 8; m++) { await playMatch(3); check(`s5 ten players ${m}`); }
  report.notes.push(`s5 ten players, 8 matches -> labels used ${state.teamSeq}, standings rows ${Object.keys(state.standings).length}`);
  // 7 players futsal -> 4 x 3 split
  localStorage.clear(); state = defaultState(); state.selectedTeams = ['robson']; syncPool();
  state.players.slice(0, 7).forEach(p => checkIn(p.id)); buildTeams(); check('s5 seven');
  report.notes.push(`s5 seven players -> ${state.court.A.ids.length} x ${state.court.B.ids.length}`);
  // everyone leaves the court
  [...state.court.A.ids].forEach(id => checkOut(id)); check('s5 court emptied');
  if (state.court.A) report.violations.push('s5: empty team not cleared');
  buildTeams(); check('s5 rebuild');

  // ---------- Scenario 6: legacy v3 data ----------
  const legacy = { selectedTeams: ['fiasco'], customTeams: [{ id: 'custom_1', name: 'Velha' }],
    players: [{ id: 1, name: 'A1', goals: 2, present: true, teamId: 'fiasco' }, { id: 1, name: 'A2', present: false }, { id: 3, name: 'A3', present: true }],
    match: { teamA: 1, teamB: 2, scoreA: 1, scoreB: 0, events: [], gameFormat: 'futsal' },
    matchHistory: [{ timestamp: '10:00', teamA: 1, teamB: 2, scoreA: 1, scoreB: 0 }], standings: { 1: { matches: 1, wins: 1, draws: 0, losses: 0, gf: 1, ga: 0, sg: 1 }, 2: { matches: 1, wins: 0, draws: 0, losses: 1, gf: 0, ga: 1, sg: -1 } } };
  localStorage.setItem(dataKey(), JSON.stringify(legacy)); loadState();
  if (!state.turmas.some(t => t.name === 'Velha')) report.violations.push('s6: legacy custom turma lost');
  if (new Set(state.players.map(p => p.id)).size !== state.players.length) report.violations.push('s6: legacy duplicate ids not fixed');
  if (state.queue.length !== 2) report.violations.push(`s6: legacy queue ${state.queue.length}`);
  try { renderAllComponents(); } catch (e) { report.violations.push('s6 render ' + e.message); }

  // ---------- Scenario 7: goal limit auto-finish & new day ----------
  localStorage.clear(); state = defaultState(); state.selectedTeams = ['futheavenly']; syncPool();
  checkInAll(); buildTeams(); state.match.goalLimitRule = '2';
  goal('B'); goal('B'); await new Promise(r => setTimeout(r, 900)); check('s7 limit');
  if (state.matchHistory.length !== 1) report.violations.push('s7: goal limit did not finish the match');
  await startNewDay(); check('s7 new day');
  if (presentPlayers().length || state.matchHistory.length || state.players.some(hasStats)) report.violations.push('s7: new day did not reset');
  if (!state.turmas.length || !state.selectedTeams.includes('futheavenly')) report.violations.push('s7: new day lost turmas');


  // ---------- Scenario 8: two-step goal via the UI, extra time ----------
  localStorage.clear(); state = defaultState(); state.match.goalLimitRule = 'none';
  state.selectedTeams = ['fiasco']; syncPool(); checkInAll(); buildTeams();
  openGoalModal('A');
  if (document.getElementById('goal-pane-assist').classList.contains('hidden') === false) report.violations.push('s8: assist pane visible at step 1');
  document.querySelector('#modal-goal-scorers-list .pick-btn').click();
  if (document.getElementById('goal-pane-assist').classList.contains('hidden')) report.violations.push('s8: step 2 did not open');
  if (state.match.scoreA !== 0) report.violations.push('s8: goal recorded before choosing assist');
  const firstAssistBtn = document.querySelector('#modal-goal-assists-list .pick-btn'); firstAssistBtn.click();
  const ev = state.match.events[0];
  if (state.match.scoreA !== 1 || !ev.assistId) report.violations.push('s8: goal with assist not recorded');
  if (!state.court.A.ids.includes(ev.assistId)) report.violations.push('s8: first assist option is not a teammate');
  openGoalModal('B'); document.querySelector('#modal-goal-scorers-list .pick-btn').click();
  document.querySelector('#goal-pane-assist > button').click(); // "sem assistência"
  if (state.match.scoreB !== 1 || state.match.events[0].assistId !== null) report.violations.push('s8: solo goal wrong');
  check('s8 goals');
  setMatchDuration(600); addExtraTime(2); addExtraTime(1);
  if (state.match.secondsLeft !== 780 || state.match.addedSeconds !== 180) report.violations.push(`s8: extra time ${state.match.secondsLeft}/${state.match.addedSeconds}`);
  undoLastEvent();
  if (state.match.addedSeconds !== 120 || state.match.secondsLeft !== 720) report.violations.push('s8: undo extra wrong');
  state.match.secondsLeft = 100; // simulate 10:20 played
  setMatchDuration(420);
  if (state.match.initialSeconds !== 600 || playedSeconds() !== 620) report.violations.push(`s8: shortening below played time should be refused (${state.match.initialSeconds}, ${playedSeconds()})`);
  setMatchDuration(900); if (playedSeconds() !== 620 || state.match.secondsLeft !== 400) report.violations.push('s8: lengthening lost played time');
  await finishMatchAndNextChallenger(true);
  const h0 = state.matchHistory[0];
  if (h0.played !== 620 || h0.added !== 120 || state.match.addedSeconds !== 0) report.violations.push('s8: history time wrong');
  check('s8 finish');

  // ---------- Scenario 9: archive, backup round trip, imports ----------
  for (let m = 0; m < 3; m++) { await playMatch(3); }
  const goalsDay1 = state.players.reduce((n, p) => n + p.goals, 0);
  await startNewDay(); check('s9 new day');
  if (state.pastDays.length !== 1 || state.pastDays[0].players.reduce((n, p) => n + p.goals, 0) !== goalsDay1) report.violations.push('s9: day not archived');
  checkInAll(); buildTeams(); goal('A', false); await finishMatchAndNextChallenger(true);
  const agg = aggregatedPlayers().reduce((n, p) => n + p.goals, 0);
  if (agg !== goalsDay1 + 1) report.violations.push(`s9: aggregate goals ${agg} != ${goalsDay1 + 1}`);
  switchStatsScope('all'); switchStatsScope('today');
  // backup -> parse -> replace gives the same state
  const payload = JSON.stringify({ app: 'BABA', kind: 'backup', version: 4, exportedAt: '2026-10-08T22:00:00.000Z', state: snapshotForUndo() });
  const beforeRep = JSON.stringify(snapshotForUndo());
  pendingImport = parseImport(payload, 'BABA_Backup.json');
  if (pendingImport.days.length !== 2) report.violations.push(`s9: backup days ${pendingImport.days.length}`);
  await applyImport('replace');
  const afterRep = JSON.stringify(Object.assign(snapshotForUndo(), {}));
  if (JSON.parse(afterRep).players.length !== JSON.parse(beforeRep).players.length) report.violations.push('s9: replace changed players');
  check('s9 replace');
  // merge the same backup: turmas unchanged, today's day enters history once
  const turmasBefore = JSON.stringify(state.turmas);
  pendingImport = parseImport(payload, 'BABA_Backup.json'); await applyImport('merge');
  pendingImport = parseImport(payload, 'BABA_Backup.json'); await applyImport('merge');
  if (JSON.stringify(state.turmas) !== turmasBefore) report.violations.push('s9: merging own backup changed turmas');
  if (state.pastDays.length !== 2) report.violations.push(`s9: merge duplicated days (${state.pastDays.length})`);
  check('s9 merge');
  // another pelada's backup: new turma with a goalkeeper
  const other = { app: 'BABA', exportedAt: '2026-10-01T12:00:00.000Z', state: { v: 4, turmas: [{ id: 'x1', name: 'Pelada do Sábado', players: ['Kiko', 'Beto', 'Gabriel Marini'], keepers: ['Kiko'] }], selectedTeams: ['x1'],
    players: [{ id: 1, name: 'Kiko', saves: 4, matches: 3, present: true, arrival: 1 }, { id: 2, name: 'Gabriel Marini', goals: 2, matches: 3, present: true, arrival: 2 }], matchHistory: [{}, {}, {}], standings: {} } };
  pendingImport = parseImport(JSON.stringify(other), 'sabado.json'); await applyImport('merge');
  const sab = state.turmas.find(t => t.name === 'Pelada do Sábado');
  if (!sab || !sab.keepers.includes('Kiko')) report.violations.push('s9: other turma not imported');
  const gmAgg = aggregatedPlayers().find(p => p.name === 'Gabriel Marini');
  report.notes.push(`s9 Gabriel Marini acumulado: ${gmAgg ? gmAgg.goals + " gols, " + gmAgg.matches + ' jogos' : 'n/a'}; babas no histórico ${state.pastDays.length}`);
  check('s9 other');
  // CSV exported by BABA
  const csv = '﻿Atleta;Turma;Posicao;Chegada;Gols;Assistencias;Defesas;Jogos;Vitorias;Presenca\n"Zeca";"Quinta FC";"Goleiro";"1º";0;0;5;4;2;"Sim"\n"Tom ""Bala"" Lima";"Avulso";"Linha";"";3;1;0;4;2;"Sim"\n';
  pendingImport = parseImport(csv, 'BABA_Resumo_2026-09-30.csv');
  if (pendingImport.turmas.length !== 2 || pendingImport.days[0].players.length !== 2) report.violations.push('s9: csv parse');
  if (!pendingImport.turmas.some(t => t.players.includes('Tom "Bala" Lima'))) report.violations.push('s9: csv quotes');
  await applyImport('merge'); check('s9 csv');
  // plain names list
  pendingImport = parseImport('Ana\nBia, Caio\n\nDudu', 'galera_de_terca.txt');
  if (pendingImport.turmas[0].name !== 'galera de terca' || pendingImport.turmas[0].players.length !== 4) report.violations.push('s9: names parse');
  await applyImport('merge'); check('s9 names');
  try { parseImport('{"foo":1}', 'x.json'); report.violations.push('s9: bad json accepted'); } catch (e) {}
  openBackupModal(); renderPastDays(); closeBackupModal();
  await deletePastDay(state.pastDays[0].id); check('s9 delete day');

  return report;
}
