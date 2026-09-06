/* Yodoku — game UI. Requires engine.js (window.Yodoku). */
(function () {
  'use strict';
  const Y = window.Yodoku;
  const $ = (s, el) => (el || document).querySelector(s);
  const $$ = (s, el) => Array.from((el || document).querySelectorAll(s));

  const MODES = ['easy', 'normal', 'hard', 'ultra', 'extreme', 'daily'];
  const EMOJI = ['🩷', '🟧', '🟨', '🟩', '🟦', '🟪', '🩵', '⬜', '🟥', '🟫'];
  const LS = {
    get(k, d) { try { const v = localStorage.getItem('yodoku.' + k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('yodoku.' + k, JSON.stringify(v)); return true; } catch (e) { return false; } },
    del(k) { try { localStorage.removeItem('yodoku.' + k); } catch (e) { /* ignore */ } }
  };

  // ---------- settings & stats ----------
  const settings = Object.assign({ autoX: false, showErrors: true, checkSolution: false, patterns: false, sound: true, haptics: true, showTimer: true, seenHelp: false, tool: 'cycle', character: 'dino' }, LS.get('settings', {}));
  if (!['dino', 'koala', 'pig', 'sloth'].includes(settings.character)) settings.character = 'dino';
  const CHARACTERS = { dino: { title: 'Yodoku', name: 'Yo', prefix: 'Yo', symbol: 'yo', animal: 'dino', emoji: '🦖' }, koala: { title: 'Kodoku', name: 'Ko', prefix: 'Ko', symbol: 'ko', animal: 'koala', emoji: '🐨' }, pig: { title: 'Pigdoku', name: 'Pip', prefix: 'Pig', symbol: 'pig', animal: 'pig', emoji: '🐷' } };
  CHARACTERS.sloth = { title: 'Sludoko', name: 'Snoo', prefix: 'Slu', symbol: 'sloth', animal: 'sloth', emoji: '🦥' };
  const nextCharacter = () => { const keys = Object.keys(CHARACTERS); return keys[(keys.indexOf(settings.character) + 1) % keys.length]; };
  const character = () => CHARACTERS[settings.character];
  if (settings.variety === undefined) settings.variety = true;
  const mascot = (face = '') => '#' + character().symbol + (face ? '-' + face : '');
  function characterText(text) {
    return text.replace(/\b(?:dinos|koalas|pigs|sloths|dino|koala|pig|sloth)\b/gi, word => {
      const animal = character().animal + (/s$/i.test(word) ? 's' : '');
      return /^[A-Z]/.test(word) ? animal[0].toUpperCase() + animal.slice(1) : animal;
    }).replace(/\b(?:Yodoku|Kodoku|Pigdoku|Sludoko)\b/g, character().title).replace(/\b(?:Yo|Ko|Pip|Snoo)\b/g, character().name);
  }
  function translateCharacter(root = document.body) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const node = walker.currentNode;
      if (node.parentElement?.closest('script,style,svg,.character-choices,.brand-name')) continue;
      const text = characterText(node.nodeValue); if (text !== node.nodeValue) node.nodeValue = text;
    }
  }
  // Switch old automatic defaults to manual once; later choices are preserved.
  if (!settings.manualDefaultV2) { settings.autoX = false; settings.manualDefaultV2 = true; }
  if (!['cycle', 'dino', 'x'].includes(settings.tool)) settings.tool = 'cycle';
  const saveSettings = () => LS.set('settings', settings);
  saveSettings();
  const savedStats = LS.get('stats', {});
  const stats = savedStats && typeof savedStats === 'object' && !Array.isArray(savedStats) ? savedStats : {};
  const nonNegative = v => Number.isFinite(v) && v >= 0 ? v : 0;
  for (const m of MODES) {
    stats[m] = Object.assign({ solved: 0, best: null, streak: 0, lastDate: null }, stats[m] || {});
    stats[m].solved = Math.floor(nonNegative(stats[m].solved)); stats[m].streak = Math.floor(nonNegative(stats[m].streak));
    if (!Number.isFinite(stats[m].best) || stats[m].best < 0) stats[m].best = null;
  }
  const legacyDailyDates = !Array.isArray(stats.daily.completedDates);
  stats.daily.completedDates = legacyDailyDates ? [] : stats.daily.completedDates.filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d));
  const saveStats = () => LS.set('stats', stats);

  // ---------- date helpers ----------
  const pad = n => String(n).padStart(2, '0');
  const isoDate = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const today = () => isoDate(new Date());
  const yesterday = () => { const d = new Date(); d.setDate(d.getDate() - 1); return isoDate(d); };
  const previousDate = str => { const d = new Date(str + 'T12:00:00'); d.setDate(d.getDate() - 1); return isoDate(d); };
  if (legacyDailyDates && /^\d{4}-\d{2}-\d{2}$/.test(stats.daily.lastDate)) {
    let day = stats.daily.lastDate;
    for (let i = 0; i < Math.max(1, Math.min(36600, stats.daily.streak)); i++) { stats.daily.completedDates.push(day); day = previousDate(day); }
  }
  const fmtTime = ms => { const s = Math.floor(ms / 1000); return `${pad(Math.floor(s / 60))}:${pad(s % 60)}`; };
  const niceDate = str => new Date(str + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
  function currentStreak() {
    const d = stats.daily; if (!d.lastDate) return 0;
    return (d.lastDate === today() || d.lastDate === yesterday()) ? d.streak : 0;
  }

  // ---------- audio & haptics ----------
  let actx = null;
  const soundBuffers = new Map(), pendingSounds = new Set();
  let lastNoteSound = 0;
  function audioContext() {
    actx = actx || new (window.AudioContext || window.webkitAudioContext)();
    if (actx.state === 'suspended') actx.resume().catch(() => {});
    return actx;
  }
  function loadCharacterSounds() {
    if (!settings.sound) return;
    let context; try { context = audioContext(); } catch { return; }
    for (const event of ['x', 'clear', 'place', 'error', 'hint', 'win']) {
      const key = `${character().symbol}-${event}`;
      if (soundBuffers.has(key) || pendingSounds.has(key)) continue;
      pendingSounds.add(key);
      fetch(`assets/sounds/${key}.wav`).then(r => { if (!r.ok) throw new Error('Sound unavailable'); return r.arrayBuffer(); })
        .then(data => context.decodeAudioData(data)).then(buffer => soundBuffers.set(key, buffer)).catch(() => {}).finally(() => pendingSounds.delete(key));
    }
  }
  function playSound(event, fallback) {
    if (!settings.sound) return;
    if (['x', 'clear'].includes(event)) { const now = performance.now(); if (lastNoteSound && now - lastNoteSound < 45) return; lastNoteSound = now; }
    try {
      const context = audioContext(), buffer = soundBuffers.get(`${character().symbol}-${event}`);
      loadCharacterSounds();
      if (buffer) {
        const source = context.createBufferSource(), gain = context.createGain();
        source.buffer = buffer; gain.gain.value = .65; source.connect(gain); gain.connect(context.destination); source.start();
        source.onended = () => { source.disconnect(); gain.disconnect(); };
        return;
      }
    } catch { /* The synthesized fallback also handles unsupported audio. */ }
    fallback();
  }
  function tone(freq, dur, type, vol, when) {
    if (!settings.sound) return;
    try {
      audioContext();
      if (settings.character === 'koala') freq *= .75;
      if (settings.character === 'pig') freq *= 1.125;
      if (settings.character === 'sloth') freq *= .625;
      const t = actx.currentTime + (when || 0);
      const o = actx.createOscillator(), g = actx.createGain();
      o.type = type || 'sine'; o.frequency.setValueAtTime(freq, t);
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol || 0.12, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g); g.connect(actx.destination); o.start(t); o.stop(t + dur + 0.02);
    } catch (e) { /* no audio */ }
  }
  const sfx = {
    x: () => playSound('x', () => tone(440, 0.06, 'triangle', 0.08)),
    clear: () => playSound('clear', () => tone(294, 0.07, 'triangle', 0.07)),
    place: () => playSound('place', () => { tone(523, 0.09, 'sine', 0.12); tone(784, 0.14, 'sine', 0.12, 0.07); }),
    error: () => playSound('error', () => tone(220, 0.14, 'triangle', 0.07)),
    hint: () => playSound('hint', () => { tone(659, 0.08, 'sine', 0.08); tone(880, 0.12, 'sine', 0.08, 0.09); }),
    win: () => playSound('win', () => [523, 659, 784, 1046].forEach((f, i) => tone(f, 0.22, 'sine', 0.12, i * 0.11)))
  };
  const buzz = ms => { if (settings.haptics && navigator.vibrate) { try { navigator.vibrate(ms); } catch (e) { /* ignore */ } } };

  // ---------- toast ----------
  const toastEl = $('#toast'); let toastTimer = 0;
  function toast(msg, ms) {
    toastEl.textContent = characterText(msg); toastEl.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => toastEl.classList.remove('show'), ms || 2200);
  }

  // ---------- game state ----------
  let mode = LS.get('mode', 'normal'); if (!MODES.includes(mode)) mode = 'normal';
  let game = null;  // { puzzle, cells, autoOwner, history, elapsed, running, startedAt, hints, solved, seed, dateStr, colors }
  const board = $('#board'), linesEl = $('#lines');
  let cellEls = [];
  let visibleIssues = [], issueIndex = 0, areaTimer = 0, reactionTimer = 0, winTimer = 0;
  let restoredInvalid = false;
  let storageWarning = false;

  function newSeed() {
    if (window.crypto && crypto.getRandomValues) { const a = new Uint32Array(1); crypto.getRandomValues(a); return a[0]; }
    return (Math.random() * 4294967296) >>> 0;
  }

  function makeGame(puzzle, extra) {
    const N = puzzle.n * puzzle.n;
    const r = Y.rng(puzzle.seed ^ 0x9E3779B9);
    const colors = Array.from({ length: puzzle.n }, (_, i) => i);
    for (let i = colors.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [colors[i], colors[j]] = [colors[j], colors[i]]; }
    return Object.assign({
      puzzle, cells: new Array(N).fill(0), autoOwner: new Array(N).fill(-1), history: [],
      elapsed: 0, running: false, startedAt: 0, hints: 0, solved: false, seed: puzzle.seed, dateStr: null, colors
    }, extra || {});
  }

  function freshPuzzle(m) {
    if (m === 'daily') {
      const d = today();
      const p = Y.generate({ difficulty: Y.dailyDifficulty(d), size: Y.dailySize(d), seed: Y.dailySeed(d) });
      return makeGame(p, { dateStr: d });
    }
    return makeGame(Y.generate({ difficulty: m, seed: newSeed() }));
  }

  function saveGame() {
    if (!game) return;
    const g = game;
    const saved = { puzzle: g.puzzle, history: g.history, seed: g.seed, dateStr: g.dateStr, cells: g.cells, autoOwner: g.autoOwner, autoX: settings.autoX, elapsed: currentElapsed(), hints: g.hints, solved: g.solved };
    if (!LS.set('game.' + mode, saved)) {
      const boardSaved = LS.set('game.' + mode, { ...saved, history: [] });
      if (!storageWarning) toast(boardSaved ? 'Storage is full. Your board is saved, but undo history will reset after reload.' : 'Saving is unavailable. Keep this tab open to retain your progress.', 5000);
      storageWarning = true;
    }
    updateTabDots();
  }
  function loadGame(m) {
    const s = LS.get('game.' + m, null);
    if (!s) return null;
    if (m === 'daily' && s.dateStr !== today()) { if (s.dateStr) LS.set('dailyArchive.' + s.dateStr, s); return null; }
    try {
      const p = s.puzzle || (m === 'daily'
        ? Y.generate({ difficulty: Y.dailyDifficulty(s.dateStr), size: Y.dailySize(s.dateStr), seed: Y.dailySeed(s.dateStr) })
        : Y.generate({ difficulty: m, seed: s.seed }));
      const expectedN = m === 'daily' ? Y.dailySize(s.dateStr) : Y.DIFFS[m].n;
      if (!Y.validatePuzzle(p) || p.n !== expectedN || Y.countSolutions(p.n, p.region, 2) !== 1) {
        // Keep the old save recoverable if it contains a missing or broken region.
        LS.set('recovery.' + m, s); restoredInvalid = true; return null;
      }
      const validCells = cells => Array.isArray(cells) && cells.length === p.n * p.n && cells.every(v => v === 0 || v === 1 || v === 2);
      if (!validCells(s.cells)) { LS.set('recovery.' + m, s); restoredInvalid = true; return null; }
      function restoreMove(move) {
        const cells = move.cells.slice(), owners = Array.isArray(move.autoOwner) ? move.autoOwner : [];
        const autoOwner = cells.map((v, i) => {
          const owner = owners[i];
          return v === 1 && Number.isInteger(owner) && owner >= 0 && owner < cells.length && cells[owner] === 2 && Y.coverage(p.n, p.region, owner).has(i) ? owner : -1;
        });
        return { cells, autoOwner };
      }
      const loaded = makeGame(p, { ...restoreMove(s), history: (Array.isArray(s.history) ? s.history : []).filter(h => h && validCells(h.cells)).map(restoreMove), elapsed: nonNegative(s.elapsed), hints: Math.floor(nonNegative(s.hints)), solved: !!s.solved && Y.isSolved(p.n, p.region, s.cells), dateStr: s.dateStr || null });
      if (!settings.autoX || s.autoX === false) for (const move of [loaded, ...loaded.history]) syncAssistance(move, p);
      return loaded;
    } catch (e) { return null; }
  }

  // ---------- timer ----------
  const timerEl = $('#timer');
  function currentElapsed() { return game ? game.elapsed + (game.running ? Math.max(0, performance.now() - game.startedAt) : 0) : 0; }
  function startTimer() { if (game && !game.running && !game.solved && !document.hidden && !$('.scrim.open')) { game.running = true; game.startedAt = performance.now(); } }
  function pauseTimer() { if (game && game.running) { game.elapsed = currentElapsed(); game.running = false; } }
  function resumeTimer() { if (game && (game.elapsed > 0 || game.hints > 0 || game.history.length > 0 || game.cells.some(v => v))) startTimer(); }
  function renderTimer() { timerEl.textContent = fmtTime(currentElapsed()); timerEl.style.visibility = settings.showTimer ? 'visible' : 'hidden'; }
  let calendarDay = today();
  function checkCalendarDay() {
    if (calendarDay === today()) return;
    calendarDay = today(); renderLabels(); updateTabDots();
    if (mode === 'daily' && game.dateStr !== today()) toast('A new Daily is ready. Finish this puzzle, or tap Today.', 4000);
  }
  setInterval(() => { renderTimer(); checkCalendarDay(); }, 500);
  document.addEventListener('visibilitychange', () => { if (document.hidden) { pauseTimer(); saveGame(); } else { checkCalendarDay(); resumeTimer(); } });
  window.addEventListener('pagehide', () => { pauseTimer(); saveGame(); });

  // ---------- rendering ----------
  function buildBoard() {
    const { n, region } = game.puzzle;
    $('#regionInspector').classList.add('hidden');
    $('#btnRegions').setAttribute('aria-expanded', 'false');
    $('#btnRegions').textContent = `${n} colours`;
    const regionButtons = $('#regionButtons'); regionButtons.innerHTML = '';
    for (let g = 0; g < n; g++) {
      const count = region.filter(id => id === g).length;
      const button = document.createElement('button');
      button.textContent = g + 1; button.style.background = `var(--c${game.colors[g]})`;
      button.setAttribute('aria-label', `Region ${g + 1}, ${count} ${count === 1 ? 'square' : 'squares'}`);
      button.setAttribute('aria-pressed', 'false');
      button.addEventListener('click', () => inspectRegion(g)); regionButtons.appendChild(button);
    }
    regionButtons.style.setProperty('--regions', n);
    board.style.setProperty('--n', n);
    board.setAttribute('aria-rowcount', n);
    board.setAttribute('aria-colcount', n);
    board.classList.toggle('won', game.solved);
    board.classList.toggle('patterns', settings.patterns);
    $$('.cell', board).forEach(el => el.remove());
    cellEls = [];
    const frag = document.createDocumentFragment();
    for (let i = 0; i < n * n; i++) {
      const el = document.createElement('div');
      el.className = 'cell'; el.dataset.i = i; el.setAttribute('role', 'gridcell');
      el.tabIndex = i === 0 ? 0 : -1;
      el.style.background = `var(--c${game.colors[region[i]]})`;
      el.dataset.region = region[i] + 1;
      const angles = [0, 45, 90, 135, 30, 60, 120, 150, 15, 75];
      el.style.setProperty('--pattern', region[i] % 3 === 0 ? 'radial-gradient(circle, #28584130 1px, transparent 1.5px)' : `repeating-linear-gradient(${angles[region[i]]}deg,transparent 0 7px,#28584120 7px 8px,transparent 8px 12px)`);
      frag.appendChild(el); cellEls.push(el);
    }
    board.insertBefore(frag, linesEl);
    // region borders
    let d1 = '', d2 = '';
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const i = y * n + x;
      if (x < n - 1) { const seg = `M${x + 1} ${y}v1`; if (region[i] !== region[i + 1]) d2 += seg; else d1 += seg; }
      if (y < n - 1) { const seg = `M${x} ${y + 1}h1`; if (region[i] !== region[i + n]) d2 += seg; else d1 += seg; }
    }
    linesEl.setAttribute('viewBox', `0 0 ${n} ${n}`);
    linesEl.innerHTML = `<path class="thin" d="${d1}"/><path class="thick" d="${d2}"/>`;
    for (let i = 0; i < n * n; i++) renderCell(i, false);
    renderErrors();
    renderLabels();
  }

  function renderCell(i, animate) {
    const el = cellEls[i], v = game.cells[i];
    el.classList.toggle('auto', game.autoOwner[i] >= 0);
    const want = v === 0 ? '' : v === 1 ? 'x' : 'dino';
    if (el.dataset.v === want && !animate) return;
    el.dataset.v = want;
    el.setAttribute('aria-label', `Row ${Math.floor(i / game.puzzle.n) + 1}, column ${i % game.puzzle.n + 1}, region ${game.puzzle.region[i] + 1}: ${v === 0 ? 'empty' : v === 1 ? 'crossed out' : character().animal}`);
    if (v === 0) el.innerHTML = '';
    else if (v === 1) el.innerHTML = `<div class="x${animate ? ' pop' : ''}"><svg><use href="#xmark"/></svg></div>`;
    else {
      const look = ['', 'bow', 'explorer', 'cozy'][(game.puzzle.region[i] + game.seed % 4) % 4];
      el.innerHTML = `<div class="dino${animate ? ' pop' : ''}"><svg><use href="${mascot()}"/>${settings.variety && look ? `<use class="friend-accessory" href="#friend-${look}"/>` : ''}</svg></div>`;
    }
  }

  function renderErrors() {
    const { n, region } = game.puzzle;
    const ruleIssues = Y.conflictDetails(n, region, game.cells);
    const count = game.cells.filter(v => v === 2).length;
    // An unfinished full board must explain why it has not won, even with live feedback off.
    visibleIssues = (settings.showErrors || count >= n) ? ruleIssues : [];
    if (settings.checkSolution) game.cells.forEach((v, i) => {
      if (v === 2 && game.puzzle.sol[Math.floor(i / n)] !== i % n)
        visibleIssues.push({ kind: 'solution', dinos: [i], area: [i], message: 'This dino is not in its solution spot. Try another home or use Undo.' });
    });
    const bad = new Set(visibleIssues.flatMap(issue => issue.dinos));
    issueIndex = Math.min(issueIndex, Math.max(0, visibleIssues.length - 1));
    for (let i = 0; i < cellEls.length; i++) {
      const el = cellEls[i], isBad = bad.has(i);
      el.classList.toggle('err', isBad);
      el.setAttribute('aria-invalid', String(isBad));
      if (isBad) el.setAttribute('aria-description', characterText(visibleIssues.filter(issue => issue.dinos.includes(i)).map(issue => issue.message).join(' '))); else el.removeAttribute('aria-description');
      const use = el.querySelector('.dino use'); if (use) use.setAttribute('href', mascot(game.solved ? 'happy' : isBad ? 'oops' : ''));
    }
    renderFeedback();
    return bad.size;
  }
  function renderFeedback() {
    const { n, region } = game.puzzle, conflicts = Y.conflicts(n, region, game.cells);
    const issue = visibleIssues[issueIndex], placed = conflicts.count;
    $('#feedback').classList.toggle('has-error', !!issue);
    $('#feedback').classList.toggle('has-hint', !!activeHint);
    $('#feedback').classList.toggle('has-region', !$('#regionInspector').classList.contains('hidden'));
    $('#feedbackMessage').textContent = game.solved ? "Everyone’s home! You made a happy little neighbourhood." : issue ?
      (placed >= n ? 'Nearly home! ' : '') + issue.message : 'One per row, column & region. No touching—even diagonally.';
    $('#conflictActions').classList.toggle('hidden', !issue);
    $('#btnFeedbackUndo').disabled = !game.history.length || game.solved;
    $('#btnShowConflict').textContent = visibleIssues.length > 1 ? `Next conflict · ${issueIndex + 1}/${visibleIssues.length}` : 'Show conflict';
    let settled = placed - conflicts.bad.size;
    if (settings.checkSolution) settled = game.cells.filter((v, i) => v === 2 && !conflicts.bad.has(i) && game.puzzle.sol[Math.floor(i / n)] === i % n).length;
    const progress = $('#settledProgress'); progress.setAttribute('aria-valuemax', n); progress.setAttribute('aria-valuenow', settled);
    progress.setAttribute('aria-valuetext', characterText(`${settled} of ${n} dinos without conflicts`));
    $('span', progress).style.width = `${settled / n * 100}%`;
    translateCharacter($('#feedback'));
    return settled;
  }
  function inspectRegion(g) {
    cellEls.forEach((el, i) => { el.classList.toggle('region-selected', game.puzzle.region[i] === g); el.classList.toggle('region-muted', game.puzzle.region[i] !== g); });
    Array.from($('#regionButtons').children).forEach((button, i) => button.setAttribute('aria-pressed', String(i === g)));
    const count = game.puzzle.region.filter(id => id === g).length;
    $('#regionMessage').textContent = `Region ${g + 1}: ${count} ${count === 1 ? 'square' : 'squares'}. It needs one dino.`;
    translateCharacter($('#regionInspector'));
  }
  function closeRegionInspector() {
    cellEls.forEach(el => el.classList.remove('region-selected', 'region-muted'));
    $('#regionInspector').classList.add('hidden'); $('#btnRegions').setAttribute('aria-expanded', 'false');
    if (game) renderFeedback();
  }
  $('#btnRegions').addEventListener('click', () => {
    if (!$('#regionInspector').classList.contains('hidden')) { closeRegionInspector(); return; }
    clearHints(); $('#regionInspector').classList.remove('hidden'); $('#btnRegions').setAttribute('aria-expanded', 'true');
    inspectRegion(0); renderFeedback();
  });
  $('#btnRegionsClose').addEventListener('click', () => { closeRegionInspector(); $('#btnRegions').focus(); });
  function highlightConflict() {
    clearTimeout(areaTimer); cellEls.forEach(el => el.classList.remove('conflict-area'));
    const issue = visibleIssues[issueIndex];
    if (issue) issue.area.forEach(i => cellEls[i].classList.add('conflict-area'));
    areaTimer = setTimeout(() => cellEls.forEach(el => el.classList.remove('conflict-area')), 1800);
  }
  $('#btnShowConflict').addEventListener('click', () => { issueIndex = (issueIndex + 1) % visibleIssues.length; renderFeedback(); highlightConflict(); });
  $('#btnFeedbackUndo').addEventListener('click', () => $('#btnUndo').click());

  function renderLabels() {
    const n = game.puzzle.n;
    $('#inputTip').textContent = `${renderFeedback()}/${n} settled · ` + (settings.tool === 'cycle' ? 'Tap: X → dino → clear' : settings.tool === 'dino' ? 'Tap to place or remove a dino' : 'Tap or drag to mark Xs');
    const lbl = $('#levelLabel');
    if (mode === 'daily') {
      const streak = currentStreak();
      lbl.innerHTML = `<b>Daily</b> · ${niceDate(game.dateStr)} · ${n}×${n}` + (streak ? ` <span class="streak-flame"><svg width="14" height="14" style="display:inline;vertical-align:-2px"><use href="#i-flame"/></svg>${streak}</span>` : '');
    } else {
      lbl.innerHTML = `<b>Level ${stats[mode].solved + (game.solved ? 0 : 1)}</b> · ${n}×${n}`;
    }
    $('#btnUndo').disabled = game.history.length === 0 || game.solved;
    $('#btnHint').disabled = game.solved;
    $('#btnClear').disabled = game.solved;
    const nextBtn = $('#btnNew');
    if (mode === 'daily') {
      nextBtn.innerHTML = game.dateStr !== today() ? '<svg><use href="#i-next"/></svg>Today' : game.solved ? '<svg><use href="#i-share"/></svg>Share' : '<svg><use href="#i-next"/></svg>Skip';
      nextBtn.disabled = false;
    } else {
      nextBtn.innerHTML = game.solved ? '<svg><use href="#i-next"/></svg>Next' : '<svg><use href="#i-next"/></svg>New';
    }
    renderTimer();
    translateCharacter();
  }

  function updateTabDots() {
    for (const t of $$('.tab')) {
      const m = t.dataset.mode, s = LS.get('game.' + m, null);
      const live = s && !s.solved && Array.isArray(s.cells) && s.cells.some(v => v !== 0) && (m !== 'daily' || s.dateStr === today());
      t.classList.toggle('has-progress', !!live);
      t.setAttribute('aria-selected', m === mode ? 'true' : 'false');
    }
  }

  // ---------- moves ----------
  function snapshot() { game.history.push({ cells: game.cells.slice(), autoOwner: game.autoOwner.slice() }); }
  function clearAutomatic(state) {
    for (let i = 0; i < state.cells.length; i++) if (state.autoOwner[i] >= 0) {
      if (state.cells[i] === 1) state.cells[i] = 0;
      state.autoOwner[i] = -1;
    }
  }
  function syncAssistance(state, puzzle) {
    if (!settings.autoX) { clearAutomatic(state); return; }
    state.cells.forEach((v, i) => {
      if (v === 2) for (const j of Y.coverage(puzzle.n, puzzle.region, i)) if (state.cells[j] === 0) { state.cells[j] = 1; state.autoOwner[j] = i; }
    });
  }
  function renderInput() {
    $('#btnAutoX').setAttribute('aria-pressed', String(settings.autoX));
    $('#btnAutoX').textContent = `Auto X · ${settings.autoX ? 'On' : 'Off'}`;
    $('[data-setting="autoX"]').setAttribute('aria-checked', String(settings.autoX));
    for (const t of $$('[data-tool]')) t.setAttribute('aria-pressed', String(t.dataset.tool === settings.tool));
  }
  function toggleAutoX() {
    clearHints();
    settings.autoX = !settings.autoX;
    // Apply the preference to historical automatic marks too, so Undo does not
    // resurrect notes removed by switching assistance off, or omit newly enabled notes.
    if (game) for (const h of game.history) syncAssistance(h, game.puzzle);
    if (game && !game.solved) {
      if (!settings.autoX) clearAutomatic(game);
      else game.cells.forEach((v, i) => { if (v === 2) applyAutoX(i); });
      for (let i = 0; i < cellEls.length; i++) renderCell(i, false);
      renderErrors(); renderLabels(); saveGame();
    }
    saveSettings(); renderInput();
    toast(settings.autoX ? 'Auto X on — Yo helps with your notes' : 'Auto X off — your manual notes stay');
  }
  $('#btnAutoX').addEventListener('click', toggleAutoX);
  for (const t of $$('[data-tool]')) t.addEventListener('click', () => { settings.tool = t.dataset.tool; saveSettings(); renderInput(); renderLabels(); });

  function applyAutoX(i) {
    const { n, region } = game.puzzle;
    for (const j of Y.coverage(n, region, i)) if (game.cells[j] === 0) { game.cells[j] = 1; game.autoOwner[j] = i; }
  }
  function removeAutoX(i) {
    const { n, region } = game.puzzle, N = n * n;
    const dinos = []; for (let d = 0; d < N; d++) if (game.cells[d] === 2 && d !== i) dinos.push(d);
    const cov = dinos.map(d => Y.coverage(n, region, d));
    for (let j = 0; j < N; j++) {
      if (game.autoOwner[j] !== i) continue;
      const k = cov.findIndex(c => c.has(j));
      if (k >= 0) game.autoOwner[j] = dinos[k]; else { game.cells[j] = 0; game.autoOwner[j] = -1; }
    }
  }

  // set one cell to a value, handling auto-X bookkeeping. Returns true if changed.
  function setCell(i, v) {
    const cur = game.cells[i]; if (cur === v) return false;
    if (cur === 2) removeAutoX(i);
    game.cells[i] = v; game.autoOwner[i] = -1;
    if (v === 2 && settings.autoX) applyAutoX(i);
    return true;
  }

  function afterMove(changed, animateIdx) {
    for (let i = 0; i < cellEls.length; i++) renderCell(i, i === animateIdx);
    const bad = renderErrors();
    // React once to the conflicting placement, not to unrelated notes or corrections.
    if (bad && changed && animateIdx >= 0 && game.cells[animateIdx] === 2 && cellEls[animateIdx].classList.contains('err')) {
      issueIndex = Math.max(0, visibleIssues.findIndex(issue => issue.dinos.includes(animateIdx)));
      highlightConflict();
      clearTimeout(reactionTimer); cellEls.forEach(el => el.classList.toggle('reaction', el.classList.contains('err')));
      reactionTimer = setTimeout(() => cellEls.forEach(el => el.classList.remove('reaction')), 350);
    }
    startTimer();
    checkWin();
    renderLabels();
    saveGame();
  }

  function tapCell(i, value) {
    if (game.solved) return;
    newArmed = 0;
    closeRegionInspector();
    clearHints();
    const cur = game.cells[i], next = value !== undefined ? value : settings.tool === 'dino' ? (cur === 2 ? 0 : 2) : settings.tool === 'x' ? (cur === 1 ? 0 : cur === 2 ? 2 : 1) : (cur + 1) % 3;
    if (cur === next) return;
    snapshot();
    setCell(i, next);
    afterMove(true, i);
    if (game.solved) return;
    if (next === 2 && cellEls[i].classList.contains('err')) { sfx.error(); buzz(20); }
    else if (next === 1) { sfx.x(); buzz(8); } else if (next === 2) { sfx.place(); buzz(15); } else { sfx.clear(); buzz(8); }
  }

  // drag painting
  let drag = null; // { down:i, moved:false, mode:'x'|'clear'|null, touched:Set, snapshotTaken }
  function cellFromPoint(x, y) {
    const r = board.getBoundingClientRect(), n = game.puzzle.n;
    const cx = Math.floor((x - r.left - board.clientLeft) / board.clientWidth * n), cy = Math.floor((y - r.top - board.clientTop) / board.clientHeight * n);
    if (cx < 0 || cy < 0 || cx >= n || cy >= n) return -1;
    return cy * n + cx;
  }
  board.addEventListener('pointerdown', e => {
    if (!game || game.solved || e.button > 0 || drag || !e.isPrimary) return;
    const i = cellFromPoint(e.clientX, e.clientY); if (i < 0) return;
    cellEls.forEach((el, k) => el.tabIndex = k === i ? 0 : -1);
    cellEls[i].focus({ preventScroll: true });
    drag = { down: i, moved: false, mode: null, touched: new Set([i]), pid: e.pointerId, lastX: e.clientX, lastY: e.clientY };
    try { board.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    cellEls[i].classList.add('press');
    e.preventDefault();
  });
  function visitDragCell(i) {
    if (i < 0 || drag.touched.has(i)) return;
    if (!drag.moved) {
      drag.moved = true; closeRegionInspector(); clearHints(); newArmed = 0;
      cellEls[drag.down].classList.remove('press');
      const v0 = game.cells[drag.down];
      drag.mode = settings.tool === 'dino' ? null : v0 === 0 ? 'x' : v0 === 1 ? 'clear' : null;
      if (drag.mode) { snapshot(); paint(drag.down); }
    }
    drag.touched.add(i);
    if (drag.mode) paint(i);
  }
  function moveDrag(e) {
    if (!drag || e.pointerId !== drag.pid) return;
    // Pointer events can jump several cells on a quick phone swipe. Sample the
    // segment so every square crossed is included, not just event endpoints.
    const dx = e.clientX - drag.lastX, dy = e.clientY - drag.lastY;
    const steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) / (board.clientWidth / game.puzzle.n / 3)));
    for (let k = 1; k <= steps; k++) visitDragCell(cellFromPoint(drag.lastX + dx * k / steps, drag.lastY + dy * k / steps));
    drag.lastX = e.clientX; drag.lastY = e.clientY;
  }
  board.addEventListener('pointermove', moveDrag);
  function paint(i) {
    const v = game.cells[i];
    if (drag.mode === 'x' && v === 0) { game.cells[i] = 1; game.autoOwner[i] = -1; renderCell(i, true); sfx.x(); }
    else if (drag.mode === 'clear' && v === 1) { game.cells[i] = 0; game.autoOwner[i] = -1; renderCell(i, true); sfx.clear(); }
    else return;
    buzz(5);
  }
  function endDrag(e) {
    if (!drag || (e && e.pointerId !== drag.pid)) return;
    if (e?.type === 'pointerup') moveDrag(e);
    const d = drag; drag = null;
    cellEls[d.down].classList.remove('press');
    if (!d.moved) { if (e?.type === 'pointerup' && cellFromPoint(e.clientX, e.clientY) === d.down) tapCell(d.down); return; }
    if (d.mode) afterMove(true, -1);
  }
  board.addEventListener('pointerup', endDrag);
  board.addEventListener('pointercancel', endDrag);
  board.addEventListener('lostpointercapture', () => { if (drag) endDrag({ pointerId: drag.pid, type: 'pointercancel' }); });
  board.addEventListener('contextmenu', e => e.preventDefault());

  // ---------- hints ----------
  let activeHint = null;
  function clearHints() {
    for (const el of cellEls) el.classList.remove('hint', 'hint-focus', 'conflict-area');
    clearTimeout(areaTimer); activeHint = null; $('#hintCard').classList.add('hidden'); $('#feedback').classList.remove('has-hint');
  }
  function showHint() {
    if (!game || game.solved) return;
    closeRegionInspector();
    if (activeHint) { $('#hintCard').scrollIntoView({ block: 'nearest', behavior: 'instant' }); return; }
    clearHints();
    const h = Y.hint(game.puzzle, game.cells);
    let area = h.cells || [];
    if (h.kind === 'wrong' || h.kind === 'badx') area = game.puzzle.region.flatMap((g, i) => g === game.puzzle.region[h.cells[0]] ? [i] : []);
    activeHint = { h, area, stage: 1 };
    for (const i of area) cellEls[i].classList.add('hint');
    game.hints++; sfx.hint(); buzz(10);
    renderHint();
    startTimer();
    saveGame();
  }
  function renderHint() {
    const { h, stage } = activeHint;
    $('#hintCard').classList.remove('hidden');
    $('#feedback').classList.add('has-hint');
    $('#hintTitle').textContent = ['A little nudge · 1/3', 'The reasoning · 2/3', 'The next step · 3/3'][stage - 1];
    let message = stage === 1 ? 'Look at the outlined area. What still fits here?' :
      h.kind === 'wrong' ? 'A dino in this region is not in its solution spot. Reconsider its home.' :
      h.kind === 'badx' ? 'A note in this region rules out a needed home. Reconsider your X marks.' : h.msg;
    if (stage === 3) {
      const targets = h.kind === 'wrong' || h.kind === 'badx' ? h.cells : h.focus || [];
      const valid = targets.filter(i => Number.isInteger(i) && cellEls[i]);
      valid.forEach(i => cellEls[i].classList.add('hint-focus'));
      const places = valid.map(i => `row ${Math.floor(i / game.puzzle.n) + 1}, column ${i % game.puzzle.n + 1}`).join('; ');
      message = h.kind === 'wrong' ? `Remove the dino at ${places}.` : h.kind === 'badx' ? `Clear the X at ${places}.` :
        ['single', 'look'].includes(h.kind) ? `Place a dino at ${places}.` : valid.length ? `Mark X at ${places}. ${h.msg}` : h.msg;
    }
    $('#hintMessage').textContent = message;
    translateCharacter($('#hintCard'));
    $('#btnHintMore').textContent = stage === 1 ? 'Explain why' : 'Show exact cells';
    $('#btnHintMore').classList.toggle('hidden', stage === 3);
    $('#hintCard').scrollIntoView({ block: 'nearest', behavior: 'instant' });
  }
  $('#btnHintMore').addEventListener('click', () => { if (activeHint && activeHint.stage < 3) { activeHint.stage++; renderHint(); if (activeHint.stage === 3) $('#btnHintDismiss').focus(); } });
  $('#btnHintDismiss').addEventListener('click', () => { clearHints(); $('#btnHint').focus(); });

  // ---------- win ----------
  function checkWin() {
    const { n, region } = game.puzzle;
    if (game.solved || !Y.isSolved(n, region, game.cells)) return;
    game.solved = true; pauseTimer();
    const t = currentElapsed(), s = stats[mode];
    const alreadyCounted = mode === 'daily' && s.completedDates.includes(game.dateStr);
    if (!alreadyCounted) s.solved++;
    const isBest = !alreadyCounted && (s.best === null || t < s.best); if (isBest) s.best = t;
    if (mode === 'daily') {
      // Credit the puzzle's date, including a puzzle finished after midnight.
      if (!alreadyCounted) s.completedDates.push(game.dateStr);
      s.completedDates.sort(); s.lastDate = s.completedDates[s.completedDates.length - 1];
      s.streak = 0; let day = s.lastDate;
      const completed = new Set(s.completedDates);
      while (completed.has(day)) { s.streak++; day = previousDate(day); }
    }
    saveStats(); saveGame();
    board.classList.add('won');
    for (const el of cellEls) el.classList.remove('err');
    // wave of happy dinos
    $$('.dino', board).forEach((d, k) => { setTimeout(() => { d.classList.remove('pop'); void d.offsetWidth; d.classList.add('pop'); d.querySelector('use').setAttribute('href', mascot('happy')); }, k * 70); });
    sfx.win(); buzz([20, 60, 20, 60, 40]);
    confetti();
    const wonGame = game;
    winTimer = setTimeout(() => { if (game === wonGame) openWin(t, isBest); }, 1100);
  }

  function emojiGrid() {
    const { n, region } = game.puzzle; let out = '';
    for (let y = 0; y < n; y++) { for (let x = 0; x < n; x++) { const i = y * n + x; out += game.cells[i] === 2 ? character().emoji : EMOJI[game.colors[region[i]]]; } out += '\n'; }
    return out;
  }
  function shareText() {
    const t = fmtTime(currentElapsed()), n = game.puzzle.n;
    const head = mode === 'daily' ? `${character().title} Daily ${game.dateStr} (${n}×${n})` : `${character().title} ${Y.DIFFS[mode].label} · Level ${stats[mode].solved} (${n}×${n})`;
    const streak = mode === 'daily' && currentStreak() > 1 ? ` · 🔥 ${currentStreak()}` : '';
    return `${head}\n⏱ ${t} · 💡 ${game.hints} hint${game.hints === 1 ? '' : 's'}${streak}\n${emojiGrid()}${location.href.split('#')[0]}`;
  }
  async function share() {
    const text = shareText();
    try { if (navigator.share) { await navigator.share({ text }); return; } } catch (e) { if (e && e.name === 'AbortError') return; }
    try { await navigator.clipboard.writeText(text); toast('Copied to clipboard!'); } catch (e) { toast('Sharing not available here'); }
  }

  function openWin(t, isBest) {
    $('#winTime').textContent = fmtTime(t);
    $('#winBest').textContent = stats[mode].best !== null ? fmtTime(stats[mode].best) : '—';
    $('#winHints').textContent = game.hints;
    const subs = ['Every dino found a home.', 'Roar-some logic!', 'Not a single dino was squished.', 'Dino-mite solving!', 'Clean and cosy — no neighbours.'];
    let sub = subs[(game.seed >>> 3) % subs.length];
    if (isBest && stats[mode].solved > 1) sub = '🏆 New best time!';
    if (mode === 'daily' && currentStreak() > 1) sub += ` 🔥 ${currentStreak()}-day streak!`;
    $('#winSub').textContent = sub;
    $('#winGrid').textContent = emojiGrid();
    renderCollection();
    $('#btnWinNext').innerHTML = mode === 'daily' ? `<svg width="22" height="22"><use href="#i-next"/></svg>${game.dateStr !== today() ? 'Today’s puzzle' : 'Play more'}` : '<svg width="22" height="22"><use href="#i-next"/></svg>Next puzzle';
    openModal('#winModal');
    translateCharacter($('#winModal'));
  }

  // ---------- confetti ----------
  function confetti() {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const cv = $('#confetti'), ctx = cv.getContext('2d');
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    cv.width = innerWidth * dpr; cv.height = innerHeight * dpr; ctx.scale(dpr, dpr);
    cv.classList.remove('hidden');
    const colors = ['#6FCB73', '#FF9F6E', '#FF9BB1', '#FFD24D', '#8FD3FF', '#D4BFFF'];
    const parts = Array.from({ length: 140 }, () => ({
      x: innerWidth / 2 + (Math.random() - .5) * innerWidth * .6, y: innerHeight * .45,
      vx: (Math.random() - .5) * 14, vy: -Math.random() * 16 - 6, r: 4 + Math.random() * 6,
      c: colors[(Math.random() * colors.length) | 0], rot: Math.random() * 6.28, vr: (Math.random() - .5) * .3, egg: Math.random() < .3
    }));
    const t0 = performance.now();
    function frame(t) {
      const dt = (t - t0) / 1000; ctx.clearRect(0, 0, innerWidth, innerHeight);
      for (const p of parts) {
        p.x += p.vx; p.y += p.vy; p.vy += .45; p.vx *= .99; p.rot += p.vr;
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot); ctx.fillStyle = p.c; ctx.globalAlpha = Math.max(0, 1 - Math.max(0, dt - 1.6));
        if (p.egg && settings.character === 'pig') {
          ctx.fillStyle = '#E784A4'; ctx.beginPath(); ctx.moveTo(0, p.r * .8);
          ctx.bezierCurveTo(-p.r * 1.6, -p.r * .2, -p.r * .6, -p.r * 1.3, 0, -p.r * .4);
          ctx.bezierCurveTo(p.r * .6, -p.r * 1.3, p.r * 1.6, -p.r * .2, 0, p.r * .8); ctx.fill();
        } else if (p.egg) { if (settings.character === 'koala') ctx.fillStyle = '#8DB58A'; ctx.beginPath(); ctx.ellipse(0, 0, p.r * (settings.character === 'koala' ? .45 : .8), p.r, 0, 0, 6.29); ctx.fill(); } else ctx.fillRect(-p.r / 2, -p.r / 3, p.r, p.r * .66);
        ctx.restore();
      }
      if (dt < 2.6) requestAnimationFrame(frame); else { cv.classList.add('hidden'); ctx.clearRect(0, 0, innerWidth, innerHeight); }
    }
    requestAnimationFrame(frame);
  }

  // ---------- modals ----------
  let modalFocus = null, resumeAfterModal = false;
  function openModal(sel) {
    if (drag) endDrag({ pointerId: drag.pid, type: 'pointercancel' });
    const current = $('.scrim.open'); if (current) closeModal('#' + current.id);
    modalFocus = document.activeElement; resumeAfterModal = !!game?.running; pauseTimer();
    $(sel).classList.add('open');
    for (const el of document.body.children) if (!el.classList.contains('scrim') && el.tagName !== 'SCRIPT') el.inert = true;
    $(sel).querySelector('button')?.focus();
  }
  function closeModal(sel) {
    if (!$(sel).classList.contains('open')) return;
    $(sel).classList.remove('open');
    for (const el of document.body.children) el.inert = false;
    const hiddenOrigin = modalFocus?.closest('.scrim:not(.open)');
    (hiddenOrigin ? $('#btnHelp') : modalFocus)?.focus(); if (resumeAfterModal && !document.hidden) startTimer();
  }
  for (const s of $$('.scrim')) s.addEventListener('click', e => { if (e.target === s) closeModal('#' + s.id); });
  $('#btnHelp').addEventListener('click', () => openModal('#helpModal'));
  $('#btnHelpClose').addEventListener('click', () => { closeModal('#helpModal'); settings.seenHelp = true; saveSettings(); });
  // Practice has its own state: no game moves, time, hints, or stats are changed.
  let practiceStep = 0, practiceCells = [], practiceDone = false;
  const practiceLessons = [
    '1 of 4 · Place a friend. Tap the outlined cell to add a dino.',
    '2 of 4 · Leave a note. Tap the outlined cell to mark X: this row already has its dino.',
    '3 of 4 · Give them space. These dinos touch diagonally. Tap the outlined surprised dino to remove it.',
    '4 of 4 · Bring everyone home. Tap the three outlined cells: one dino per row, column and colour.'
  ];
  function practiceTargets() { return practiceStep === 0 ? [1] : practiceStep === 1 ? [0] : practiceStep === 2 ? [6] : [7, 8, 14].filter(i => practiceCells[i] !== 2); }
  function renderPractice() {
    $('#tutorialInstruction').textContent = practiceLessons[practiceStep];
    const targets = practiceTargets(), container = $('#practiceBoard'); container.innerHTML = '';
    for (let i = 0; i < 16; i++) {
      const button = document.createElement('button'), value = practiceCells[i];
      button.style.background = `var(--c${Math.floor(i / 4)})`;
      button.classList.toggle('target', !practiceDone && targets.includes(i));
      button.classList.toggle('practice-error', practiceStep === 2 && !practiceDone && [1, 6].includes(i));
      button.setAttribute('aria-label', `Practice row ${Math.floor(i / 4) + 1}, column ${i % 4 + 1}: ${value === 2 ? character().animal : value === 1 ? 'X' : 'empty'}${targets.includes(i) && !practiceDone ? ', try here' : ''}`);
      if (value) button.innerHTML = `<svg aria-hidden="true"><use href="${value === 1 ? '#xmark' : mascot(practiceStep === 2 && !practiceDone ? 'oops' : practiceStep === 3 && practiceDone ? 'happy' : '')}"/></svg>`;
      button.addEventListener('click', () => {
        if (practiceDone) return;
        if (!practiceTargets().includes(i)) { $('#tutorialStatus').textContent = 'Try a dashed outline. You can experiment freely in your own puzzle.'; return; }
        practiceCells[i] = practiceStep === 1 ? 1 : practiceStep === 2 ? 0 : 2;
        practiceDone = practiceStep < 3 || practiceTargets().length === 0;
        renderPractice();
        $('#tutorialStatus').textContent = practiceDone ? ['A cosy home! Every row, column and colour gets one dino.', 'Exactly! X marks are your notes. Auto X is optional.', 'Much better! Dinos need space—even corner to corner.', 'Everyone’s home! You’re ready. Undo and hints are always there to help.'][practiceStep] : 'Lovely! Keep filling the outlined homes.';
        translateCharacter($('#tutorialModal'));
        if (practiceDone) $('#btnTutorialNext').focus(); else container.children[practiceTargets()[0]].focus();
      });
      container.appendChild(button);
    }
    $('#btnTutorialNext').disabled = !practiceDone;
    $('#btnTutorialNext').textContent = practiceStep === 3 ? 'Play my puzzle' : 'Next step';
    translateCharacter($('#tutorialModal'));
  }
  $('#btnTutorial').addEventListener('click', () => {
    practiceStep = 0; practiceCells = Array(16).fill(0); practiceDone = false;
    settings.seenHelp = true; saveSettings(); renderPractice(); $('#tutorialStatus').textContent = 'A tiny practice, with no timer or penalties.';
    openModal('#tutorialModal');
  });
  $('#btnTutorialNext').addEventListener('click', () => {
    if (!practiceDone) return;
    if (practiceStep === 3) { closeModal('#tutorialModal'); $('#btnHelp').focus(); return; }
    practiceStep++; practiceDone = false; if (practiceStep === 2) practiceCells[6] = 2;
    renderPractice(); $('#tutorialStatus').textContent = 'Follow the dashed outline.';
    $('#practiceBoard').children[practiceTargets()[0]].focus();
  });
  $('#btnTutorialClose').addEventListener('click', () => { closeModal('#tutorialModal'); $('#btnHelp').focus(); });
  const MILESTONES = [{ at:1, icon:'🌱', name:'First home' }, { at:5, icon:'🌼', name:'Little garden' }, { at:15, icon:'🌳', name:'Cosy grove' }, { at:30, icon:'🌈', name:'Happy haven' }];
  function renderCollection() {
    const total = MODES.reduce((sum,m) => sum + stats[m].solved, 0), next = MILESTONES.find(m => total < m.at);
    $('#stickerBook').innerHTML = MILESTONES.map(m => `<div class="sticker${total >= m.at ? ' earned' : ''}" aria-label="${m.name}: ${total >= m.at ? 'earned' : `solve ${m.at} puzzles`}"><b aria-hidden="true">${m.icon}</b>${m.name}<br>${m.at} puzzle${m.at === 1 ? '' : 's'}</div>`).join('');
    const message = next ? `${total} solved · ${next.at - total} more for ${next.name}. Any mode, at your own pace.` : `${total} solved · Your cosy collection is complete!`;
    $('#collectionProgress').textContent = message;
    const earned = MILESTONES.find(m => total === m.at);
    $('#winCollection').textContent = earned ? `${earned.icon} ${earned.name} added to your collection!` : message;
  }
  $('#btnSettings').addEventListener('click', () => { renderStats(); renderCollection(); openModal('#settingsModal'); });
  $('#btnSettingsClose').addEventListener('click', () => closeModal('#settingsModal'));
  function renderCharacter() {
    const skin = character(); document.body.dataset.character = settings.character;
    document.title = `${skin.title} — a cosy logic puzzle`;
    $('#brandPrefix').textContent = skin.prefix;
    $('.brand-suffix').textContent = skin.title.slice(skin.prefix.length);
    const next = CHARACTERS[nextCharacter()];
    $('#btnCharacter').setAttribute('aria-label', `Switch to ${next.title}, the ${next.animal} theme`);
    $('link[rel="icon"]').setAttribute('href', settings.character === 'dino' ? 'icons/icon.svg' : `assets/${skin.symbol}-icon.svg`);
    for (const button of $$('.character-choice')) button.setAttribute('aria-pressed', String(button.dataset.character === settings.character));
    for (const button of $$('#friendPreview button')) $('use', button).setAttribute('href', mascot(button.dataset.look));
    for (const use of $$('use')) {
      if (use.closest('defs,.character-choices')) continue;
      const match = /^(?:#yo|#ko|#pig|#sloth)(-happy|-oops|-head)?$/.exec(use.getAttribute('href') || '');
      if (match) use.setAttribute('href', '#' + skin.symbol + (match[1] || ''));
    }
    $('[data-tool="dino"]').textContent = skin.animal[0].toUpperCase() + skin.animal.slice(1);
    for (let i = 0; i < cellEls.length; i++) { delete cellEls[i].dataset.v; renderCell(i, false); }
    renderErrors(); renderLabels(); translateCharacter();
  }
  function selectCharacter(value) {
    if (settings.character === value) return;
    settings.character = value; saveSettings(); renderCharacter(); loadCharacterSounds();
    const mark = $('.logo .mark'); mark.classList.remove('mascot-greeting'); void mark.offsetWidth; mark.classList.add('mascot-greeting');
    if (settings.sound) sfx.place();
    toast(`Hello from ${character().name}! Your puzzle is right where you left it.`);
  }
  $('#btnCharacter').addEventListener('click', () => selectCharacter(nextCharacter()));
  for (const button of $$('.character-choice')) button.addEventListener('click', () => selectCharacter(button.dataset.character));
  $('#btnSoundPreview').addEventListener('click', () => { if (settings.sound) sfx.place(); else toast('Turn on Sounds to hear your character.'); });
  for (const button of $$('#friendPreview button')) button.addEventListener('click', () => {
    const greetings = { bow: 'Dressed up for a little puzzle party!', explorer: 'Ready to discover another cosy home!', cozy: 'A warm scarf and a puzzle. Lovely.' };
    $('#friendGreeting').textContent = `${character().name}: ${greetings[button.dataset.look]}`;
    const svg = $('svg', button); svg.classList.remove('mascot-greeting'); void svg.offsetWidth; svg.classList.add('mascot-greeting'); sfx.place(); buzz(8);
  });
  $('#btnShare').addEventListener('click', share);
  $('#btnWinNext').addEventListener('click', () => { closeModal('#winModal'); if (mode === 'daily') switchMode(game.dateStr !== today() ? 'daily' : stats.normal.solved > 3 ? 'hard' : 'normal'); else startNew(); });
  for (const sw of $$('.switch')) {
    const k = sw.dataset.setting; sw.setAttribute('aria-checked', settings[k] ? 'true' : 'false');
    sw.setAttribute('aria-label', sw.parentElement.querySelector('b').textContent);
    sw.addEventListener('click', () => {
      if (k === 'autoX') { toggleAutoX(); return; }
      settings[k] = !settings[k]; sw.setAttribute('aria-checked', settings[k] ? 'true' : 'false'); saveSettings();
      if ((k === 'showErrors' || k === 'checkSolution') && game) { renderErrors(); renderLabels(); }
      if (k === 'patterns') board.classList.toggle('patterns', settings.patterns);
      if (k === 'variety') renderCharacter();
      if (k === 'showTimer') renderTimer();
      buzz(6);
    });
  }
  function renderStats() {
    const g = $('#statGrid'); g.innerHTML = '';
    for (const m of MODES) {
      const s = stats[m], label = m === 'daily' ? 'Daily' : Y.DIFFS[m].label;
      const extra = m === 'daily' ? ` · 🔥 ${currentStreak()}` : '';
      g.insertAdjacentHTML('beforeend', `<div class="stat"><b>${s.solved}</b><span>${label} solved${extra}<br>best ${s.best !== null ? fmtTime(s.best) : '—'}</span></div>`);
    }
  }

  // ---------- controls ----------
  $('#btnUndo').addEventListener('click', () => {
    if (!game || game.solved || !game.history.length) return;
    clearHints();
    const h = game.history.pop(); game.cells = h.cells; game.autoOwner = h.autoOwner;
    if (!settings.autoX) clearAutomatic(game);
    sfx.clear(); buzz(8);
    for (let i = 0; i < cellEls.length; i++) renderCell(i, false);
    renderErrors(); renderLabels(); saveGame();
  });
  $('#btnHint').addEventListener('click', showHint);
  $('#btnClear').addEventListener('click', () => {
    if (!game || game.solved) return;
    if (!game.cells.some(v => v)) return;
    clearHints(); snapshot();
    game.cells.fill(0); game.autoOwner.fill(-1);
    sfx.clear(); buzz(12);
    for (let i = 0; i < cellEls.length; i++) renderCell(i, false);
    renderErrors(); renderLabels(); saveGame();
    toast('Board cleared — Undo brings it back');
  });
  let newArmed = 0;
  $('#btnNew').addEventListener('click', () => {
    if (!game) return;
    if (mode === 'daily') {
      if (game.dateStr !== today()) {
        LS.set('dailyArchive.' + game.dateStr, { puzzle: game.puzzle, cells: game.cells, elapsed: currentElapsed(), solved: game.solved });
        switchMode('daily'); return;
      }
      if (game.solved) { share(); return; }
      if (Date.now() - newArmed > 2500) { newArmed = Date.now(); toast('There\'s one Daily per day. Tap again to hop to Normal instead.'); return; }
      switchMode('normal'); return;
    }
    if (!game.solved && game.cells.some(v => v)) {
      if (Date.now() - newArmed > 2500) { newArmed = Date.now(); toast('Tap New again to skip this puzzle'); return; }
    }
    startNew();
  });

  function startNew() {
    if (drag) endDrag({ pointerId: drag.pid, type: 'pointercancel' });
    newArmed = 0;
    clearTimeout(winTimer);
    clearHints(); closeModal('#winModal');
    game = freshPuzzle(mode);
    buildBoard(); saveGame();
    if (!matchMedia('(prefers-reduced-motion: reduce)').matches) board.animate([{ transform: 'scale(.94)', opacity: .4 }, { transform: 'scale(1)', opacity: 1 }], { duration: 260, easing: 'cubic-bezier(.2,.9,.3,1.2)' });
  }

  function switchMode(m) {
    if (drag) endDrag({ pointerId: drag.pid, type: 'pointercancel' });
    newArmed = 0;
    clearTimeout(winTimer);
    if (game) { pauseTimer(); saveGame(); }
    mode = m; LS.set('mode', m);
    clearHints(); closeModal('#winModal');
    game = loadGame(m) || freshPuzzle(m);
    if (game.solved && m !== 'daily') { game = freshPuzzle(m); }
    buildBoard(); updateTabDots(); checkWin(); resumeTimer(); saveGame();
    if (restoredInvalid) { restoredInvalid = false; toast('A saved puzzle had invalid regions. A fresh puzzle is ready; your old save is backed up.', 5000); }
  }
  for (const t of $$('.tab')) t.addEventListener('click', () => { if (t.dataset.mode !== mode || mode === 'daily' && game.dateStr !== today()) { buzz(6); switchMode(t.dataset.mode); } });

  // keyboard (desktop convenience)
  document.addEventListener('keydown', e => {
    const modal = $('.scrim.open');
    if (modal) {
      if (e.key === 'Escape') closeModal('#' + modal.id);
      if (e.key === 'Tab') {
        const buttons = $$('button:not([disabled]),a[href]', modal), first = buttons[0], last = buttons[buttons.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
      return;
    }
    const cell = e.target.closest('.cell');
    if (cell && !e.ctrlKey && !e.metaKey && !e.altKey) {
      const i = Number(cell.dataset.i), n = game.puzzle.n;
      const moves = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -n, ArrowDown: n };
      if (e.key in moves) {
        e.preventDefault();
        const horizontalEdge = e.key === 'ArrowLeft' && i % n === 0 || e.key === 'ArrowRight' && i % n === n - 1;
        const j = horizontalEdge ? i : Math.max(0, Math.min(n * n - 1, i + moves[e.key]));
        cell.tabIndex = -1; cellEls[j].tabIndex = 0; cellEls[j].focus(); return;
      }
      const key = e.key.toLowerCase();
      if ([' ', 'enter', 'd', 'x', 'delete', 'backspace'].includes(key)) {
        e.preventDefault(); tapCell(i, key === 'd' ? (game.cells[i] === 2 ? 0 : 2) : key === 'x' ? (game.cells[i] === 1 ? 0 : 1) : ['delete', 'backspace'].includes(key) ? 0 : undefined); return;
      }
    }
    if (e.key.toLowerCase() === 'z' && !e.shiftKey && (e.metaKey || e.ctrlKey)) { e.preventDefault(); $('#btnUndo').click(); }
    if (e.key.toLowerCase() === 'h' && !e.metaKey && !e.ctrlKey && !e.altKey) showHint();
    if (e.key === 'Escape') for (const s of $$('.scrim.open')) closeModal('#' + s.id);
  });

  // ---------- boot ----------
  switchMode(mode);
  renderInput();
  renderCharacter();
  if (!settings.seenHelp) setTimeout(() => openModal('#helpModal'), 400);
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => { /* offline support unavailable */ }));
  }
})();
