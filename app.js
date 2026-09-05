/* Yodoku — game UI. Requires engine.js (window.Yodoku). */
(function () {
  'use strict';
  const Y = window.Yodoku;
  const $ = (s, el) => (el || document).querySelector(s);
  const $$ = (s, el) => Array.from((el || document).querySelectorAll(s));

  const MODES = ['easy', 'normal', 'hard', 'ultra', 'daily'];
  const EMOJI = ['🩷', '🟧', '🟨', '🟩', '🟦', '🟪', '🩵', '⬜', '🟥'];
  const LS = {
    get(k, d) { try { const v = localStorage.getItem('yodoku.' + k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('yodoku.' + k, JSON.stringify(v)); } catch (e) { /* ignore */ } },
    del(k) { try { localStorage.removeItem('yodoku.' + k); } catch (e) { /* ignore */ } }
  };

  // ---------- settings & stats ----------
  const settings = Object.assign({ autoX: false, showErrors: true, checkSolution: false, patterns: false, sound: true, haptics: true, showTimer: true, seenHelp: false, tool: 'cycle' }, LS.get('settings', {}));
  // Switch old automatic defaults to manual once; later choices are preserved.
  if (!settings.manualDefaultV2) { settings.autoX = false; settings.manualDefaultV2 = true; }
  if (!['cycle', 'dino', 'x'].includes(settings.tool)) settings.tool = 'cycle';
  const saveSettings = () => LS.set('settings', settings);
  saveSettings();
  const stats = LS.get('stats', {});
  for (const m of MODES) stats[m] = Object.assign({ solved: 0, best: null, streak: 0, lastDate: null }, stats[m] || {});
  const saveStats = () => LS.set('stats', stats);

  // ---------- date helpers ----------
  const pad = n => String(n).padStart(2, '0');
  const isoDate = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const today = () => isoDate(new Date());
  const yesterday = () => { const d = new Date(); d.setDate(d.getDate() - 1); return isoDate(d); };
  const fmtTime = ms => { const s = Math.floor(ms / 1000); return `${pad(Math.floor(s / 60))}:${pad(s % 60)}`; };
  const niceDate = str => new Date(str + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
  function currentStreak() {
    const d = stats.daily; if (!d.lastDate) return 0;
    return (d.lastDate === today() || d.lastDate === yesterday()) ? d.streak : 0;
  }

  // ---------- audio & haptics ----------
  let actx = null;
  function tone(freq, dur, type, vol, when) {
    if (!settings.sound) return;
    try {
      actx = actx || new (window.AudioContext || window.webkitAudioContext)();
      if (actx.state === 'suspended') actx.resume();
      const t = actx.currentTime + (when || 0);
      const o = actx.createOscillator(), g = actx.createGain();
      o.type = type || 'sine'; o.frequency.setValueAtTime(freq, t);
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol || 0.12, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g); g.connect(actx.destination); o.start(t); o.stop(t + dur + 0.02);
    } catch (e) { /* no audio */ }
  }
  const sfx = {
    x: () => tone(330, 0.06, 'triangle', 0.08),
    clear: () => tone(240, 0.07, 'triangle', 0.07),
    place: () => { tone(520, 0.09, 'sine', 0.12); tone(780, 0.14, 'sine', 0.12, 0.07); },
    error: () => tone(140, 0.18, 'square', 0.05),
    hint: () => { tone(660, 0.08, 'sine', 0.08); tone(880, 0.12, 'sine', 0.08, 0.09); },
    win: () => [523, 659, 784, 1046].forEach((f, i) => tone(f, 0.22, 'sine', 0.12, i * 0.11))
  };
  const buzz = ms => { if (settings.haptics && navigator.vibrate) { try { navigator.vibrate(ms); } catch (e) { /* ignore */ } } };

  // ---------- toast ----------
  const toastEl = $('#toast'); let toastTimer = 0;
  function toast(msg, ms) {
    toastEl.textContent = msg; toastEl.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => toastEl.classList.remove('show'), ms || 2200);
  }

  // ---------- game state ----------
  let mode = LS.get('mode', 'normal'); if (!MODES.includes(mode)) mode = 'normal';
  let game = null;  // { puzzle, cells, autoOwner, history, elapsed, running, startedAt, hints, solved, seed, dateStr, colors }
  const board = $('#board'), linesEl = $('#lines');
  let cellEls = [];
  let visibleIssues = [], issueIndex = 0, areaTimer = 0, reactionTimer = 0, winTimer = 0;

  function newSeed() {
    if (window.crypto && crypto.getRandomValues) { const a = new Uint32Array(1); crypto.getRandomValues(a); return a[0]; }
    return (Math.random() * 4294967296) >>> 0;
  }

  function makeGame(puzzle, extra) {
    const N = puzzle.n * puzzle.n;
    const r = Y.rng(puzzle.seed ^ 0x9E3779B9);
    const colors = Array.from({ length: puzzle.n }, (_, i) => i % 9);
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
    LS.set('game.' + mode, { puzzle: g.puzzle, history: g.history, seed: g.seed, dateStr: g.dateStr, cells: g.cells, autoOwner: g.autoOwner, elapsed: currentElapsed(), hints: g.hints, solved: g.solved });
    updateTabDots();
  }
  function loadGame(m) {
    const s = LS.get('game.' + m, null);
    if (!s) return null;
    if (m === 'daily' && s.dateStr !== today()) return null;
    try {
      const p = s.puzzle || (m === 'daily'
        ? Y.generate({ difficulty: Y.dailyDifficulty(s.dateStr), size: Y.dailySize(s.dateStr), seed: Y.dailySeed(s.dateStr) })
        : Y.generate({ difficulty: m, seed: s.seed }));
      if (!s.cells || s.cells.length !== p.n * p.n) return null;
      const loaded = makeGame(p, { cells: s.cells, autoOwner: s.autoOwner || new Array(p.n * p.n).fill(-1), history: s.history || [], elapsed: s.elapsed || 0, hints: s.hints || 0, solved: !!s.solved, dateStr: s.dateStr || null });
      if (!settings.autoX) clearAutomatic(loaded);
      return loaded;
    } catch (e) { return null; }
  }

  // ---------- timer ----------
  const timerEl = $('#timer');
  function currentElapsed() { return game ? game.elapsed + (game.running ? Date.now() - game.startedAt : 0) : 0; }
  function startTimer() { if (game && !game.running && !game.solved) { game.running = true; game.startedAt = Date.now(); } }
  function pauseTimer() { if (game && game.running) { game.elapsed += Date.now() - game.startedAt; game.running = false; } }
  function renderTimer() { timerEl.textContent = fmtTime(currentElapsed()); timerEl.style.visibility = settings.showTimer ? 'visible' : 'hidden'; }
  setInterval(renderTimer, 500);
  document.addEventListener('visibilitychange', () => { if (document.hidden) { pauseTimer(); saveGame(); } else if (game && !game.solved && game.history.length && !$('.scrim.open')) startTimer(); });
  window.addEventListener('pagehide', () => { pauseTimer(); saveGame(); });

  // ---------- rendering ----------
  function buildBoard() {
    const { n, region } = game.puzzle;
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
      const angles = [0, 45, 90, 135, 30, 60, 120, 150, 15];
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
    el.setAttribute('aria-label', `Row ${Math.floor(i / game.puzzle.n) + 1}, column ${i % game.puzzle.n + 1}, region ${game.puzzle.region[i] + 1}: ${v === 0 ? 'empty' : v === 1 ? 'crossed out' : 'dino'}`);
    if (v === 0) el.innerHTML = '';
    else if (v === 1) el.innerHTML = `<div class="x${animate ? ' pop' : ''}"><svg><use href="#xmark"/></svg></div>`;
    else el.innerHTML = `<div class="dino${animate ? ' pop' : ''}"><svg><use href="#yo"/></svg></div>`;
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
      if (isBad) el.setAttribute('aria-description', visibleIssues.filter(issue => issue.dinos.includes(i)).map(issue => issue.message).join(' ')); else el.removeAttribute('aria-description');
      const use = el.querySelector('.dino use'); if (use) use.setAttribute('href', game.solved ? '#yo-happy' : isBad ? '#yo-oops' : '#yo');
    }
    renderFeedback();
    return bad.size;
  }
  function renderFeedback() {
    const { n, region } = game.puzzle, conflicts = Y.conflicts(n, region, game.cells);
    const issue = visibleIssues[issueIndex], placed = conflicts.count;
    $('#feedback').classList.toggle('has-error', !!issue);
    $('#feedbackMessage').textContent = game.solved ? "Everyone’s home! You made a happy little neighbourhood." : issue ?
      (placed >= n ? 'Nearly home! ' : '') + issue.message : 'One per row, column & region. No touching—even diagonally.';
    $('#conflictActions').classList.toggle('hidden', !issue);
    $('#btnFeedbackUndo').disabled = !game.history.length || game.solved;
    $('#btnShowConflict').textContent = visibleIssues.length > 1 ? `Next conflict · ${issueIndex + 1}/${visibleIssues.length}` : 'Show conflict';
    let settled = placed - conflicts.bad.size;
    if (settings.checkSolution) settled = game.cells.filter((v, i) => v === 2 && !conflicts.bad.has(i) && game.puzzle.sol[Math.floor(i / n)] === i % n).length;
    const progress = $('#settledProgress'); progress.setAttribute('aria-valuemax', n); progress.setAttribute('aria-valuenow', settled);
    progress.setAttribute('aria-valuetext', `${settled} of ${n} dinos without conflicts`);
    $('span', progress).style.width = `${settled / n * 100}%`;
    return settled;
  }
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
      nextBtn.innerHTML = game.solved ? '<svg><use href="#i-share"/></svg>Share' : '<svg><use href="#i-next"/></svg>Skip';
      nextBtn.disabled = false;
    } else {
      nextBtn.innerHTML = game.solved ? '<svg><use href="#i-next"/></svg>Next' : '<svg><use href="#i-next"/></svg>New';
    }
    renderTimer();
  }

  function updateTabDots() {
    for (const t of $$('.tab')) {
      const m = t.dataset.mode, s = LS.get('game.' + m, null);
      const live = s && !s.solved && s.cells && s.cells.some(v => v !== 0) && (m !== 'daily' || s.dateStr === today());
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
  function renderInput() {
    $('#btnAutoX').setAttribute('aria-pressed', String(settings.autoX));
    $('#btnAutoX').textContent = `Auto X · ${settings.autoX ? 'On' : 'Off'}`;
    $('[data-setting="autoX"]').setAttribute('aria-checked', String(settings.autoX));
    for (const t of $$('[data-tool]')) t.setAttribute('aria-pressed', String(t.dataset.tool === settings.tool));
  }
  function toggleAutoX() {
    clearHints();
    settings.autoX = !settings.autoX;
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
    const cx = Math.floor((x - r.left) / r.width * n), cy = Math.floor((y - r.top) / r.height * n);
    if (cx < 0 || cy < 0 || cx >= n || cy >= n) return -1;
    return cy * n + cx;
  }
  board.addEventListener('pointerdown', e => {
    if (!game || game.solved || e.button > 0 || drag || !e.isPrimary) return;
    const i = cellFromPoint(e.clientX, e.clientY); if (i < 0) return;
    cellEls.forEach((el, k) => el.tabIndex = k === i ? 0 : -1);
    cellEls[i].focus({ preventScroll: true });
    drag = { down: i, moved: false, mode: null, touched: new Set([i]), pid: e.pointerId };
    try { board.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    cellEls[i].classList.add('press');
    e.preventDefault();
  });
  board.addEventListener('pointermove', e => {
    if (!drag || e.pointerId !== drag.pid) return;
    const i = cellFromPoint(e.clientX, e.clientY);
    if (i < 0 || drag.touched.has(i)) return;
    if (!drag.moved) {
      drag.moved = true; clearHints();
      cellEls[drag.down].classList.remove('press');
      const v0 = game.cells[drag.down];
      drag.mode = settings.tool === 'dino' ? null : v0 === 0 ? 'x' : v0 === 1 ? 'clear' : null;
      if (drag.mode) { snapshot(); paint(drag.down); }
    }
    drag.touched.add(i);
    if (drag.mode) paint(i);
  });
  function paint(i) {
    const v = game.cells[i];
    if (drag.mode === 'x' && v === 0) { game.cells[i] = 1; game.autoOwner[i] = -1; renderCell(i, true); sfx.x(); }
    else if (drag.mode === 'clear' && v === 1) { game.cells[i] = 0; game.autoOwner[i] = -1; renderCell(i, true); sfx.clear(); }
    else return;
    buzz(5);
  }
  function endDrag(e) {
    if (!drag || (e && e.pointerId !== drag.pid)) return;
    const d = drag; drag = null;
    cellEls[d.down].classList.remove('press');
    if (!d.moved) { if (e && e.type !== 'pointercancel') tapCell(d.down); return; }
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
    clearTimeout(areaTimer); activeHint = null; $('#hintCard').classList.add('hidden');
  }
  function showHint() {
    if (!game || game.solved) return;
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
    s.solved++;
    const isBest = s.best === null || t < s.best; if (isBest) s.best = t;
    if (mode === 'daily') {
      if (s.lastDate === yesterday()) s.streak++; else if (s.lastDate !== today()) s.streak = 1;
      s.lastDate = today();
    }
    saveStats(); saveGame();
    board.classList.add('won');
    for (const el of cellEls) el.classList.remove('err');
    // wave of happy dinos
    $$('.dino', board).forEach((d, k) => { setTimeout(() => { d.classList.remove('pop'); void d.offsetWidth; d.classList.add('pop'); d.querySelector('use').setAttribute('href', '#yo-happy'); }, k * 70); });
    sfx.win(); buzz([20, 60, 20, 60, 40]);
    confetti();
    const wonGame = game;
    winTimer = setTimeout(() => { if (game === wonGame) openWin(t, isBest); }, 1100);
  }

  function emojiGrid() {
    const { n, region } = game.puzzle; let out = '';
    for (let y = 0; y < n; y++) { for (let x = 0; x < n; x++) { const i = y * n + x; out += game.cells[i] === 2 ? '🦖' : EMOJI[game.colors[region[i]]]; } out += '\n'; }
    return out;
  }
  function shareText() {
    const t = fmtTime(currentElapsed()), n = game.puzzle.n;
    const head = mode === 'daily' ? `Yodoku Daily ${game.dateStr} (${n}×${n})` : `Yodoku ${Y.DIFFS[mode].label} · Level ${stats[mode].solved} (${n}×${n})`;
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
    $('#btnWinNext').innerHTML = mode === 'daily' ? '<svg width="22" height="22"><use href="#i-next"/></svg>Play more' : '<svg width="22" height="22"><use href="#i-next"/></svg>Next puzzle';
    openModal('#winModal');
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
        if (p.egg) { ctx.beginPath(); ctx.ellipse(0, 0, p.r * .8, p.r, 0, 0, 6.29); ctx.fill(); } else ctx.fillRect(-p.r / 2, -p.r / 3, p.r, p.r * .66);
        ctx.restore();
      }
      if (dt < 2.6) requestAnimationFrame(frame); else { cv.classList.add('hidden'); ctx.clearRect(0, 0, innerWidth, innerHeight); }
    }
    requestAnimationFrame(frame);
  }

  // ---------- modals ----------
  let modalFocus = null, resumeAfterModal = false;
  function openModal(sel) {
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
      button.setAttribute('aria-label', `Practice row ${Math.floor(i / 4) + 1}, column ${i % 4 + 1}: ${value === 2 ? 'dino' : value === 1 ? 'X' : 'empty'}${targets.includes(i) && !practiceDone ? ', try here' : ''}`);
      if (value) button.innerHTML = `<svg aria-hidden="true"><use href="#${value === 1 ? 'xmark' : practiceStep === 2 && !practiceDone ? 'yo-oops' : practiceStep === 3 && practiceDone ? 'yo-happy' : 'yo'}"/></svg>`;
      button.addEventListener('click', () => {
        if (practiceDone) return;
        if (!practiceTargets().includes(i)) { $('#tutorialStatus').textContent = 'Try a dashed outline. You can experiment freely in your own puzzle.'; return; }
        practiceCells[i] = practiceStep === 1 ? 1 : practiceStep === 2 ? 0 : 2;
        practiceDone = practiceStep < 3 || practiceTargets().length === 0;
        renderPractice();
        $('#tutorialStatus').textContent = practiceDone ? ['A cosy home! Every row, column and colour gets one dino.', 'Exactly! X marks are your notes. Auto X is optional.', 'Much better! Dinos need space—even corner to corner.', 'Everyone’s home! You’re ready. Undo and hints are always there to help.'][practiceStep] : 'Lovely! Keep filling the outlined homes.';
        if (practiceDone) $('#btnTutorialNext').focus(); else container.children[practiceTargets()[0]].focus();
      });
      container.appendChild(button);
    }
    $('#btnTutorialNext').disabled = !practiceDone;
    $('#btnTutorialNext').textContent = practiceStep === 3 ? 'Play my puzzle' : 'Next step';
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
  $('#btnSettings').addEventListener('click', () => { renderStats(); openModal('#settingsModal'); });
  $('#btnSettingsClose').addEventListener('click', () => closeModal('#settingsModal'));
  $('#btnShare').addEventListener('click', share);
  $('#btnWinNext').addEventListener('click', () => { closeModal('#winModal'); if (mode === 'daily') switchMode(stats.normal.solved > 3 ? 'hard' : 'normal'); else startNew(); });
  for (const sw of $$('.switch')) {
    const k = sw.dataset.setting; sw.setAttribute('aria-checked', settings[k] ? 'true' : 'false');
    sw.setAttribute('aria-label', sw.parentElement.querySelector('b').textContent);
    sw.addEventListener('click', () => {
      if (k === 'autoX') { toggleAutoX(); return; }
      settings[k] = !settings[k]; sw.setAttribute('aria-checked', settings[k] ? 'true' : 'false'); saveSettings();
      if ((k === 'showErrors' || k === 'checkSolution') && game) { renderErrors(); renderLabels(); }
      if (k === 'patterns') board.classList.toggle('patterns', settings.patterns);
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
    clearTimeout(winTimer);
    clearHints(); closeModal('#winModal');
    game = freshPuzzle(mode);
    buildBoard(); saveGame();
    if (!matchMedia('(prefers-reduced-motion: reduce)').matches) board.animate([{ transform: 'scale(.94)', opacity: .4 }, { transform: 'scale(1)', opacity: 1 }], { duration: 260, easing: 'cubic-bezier(.2,.9,.3,1.2)' });
  }

  function switchMode(m) {
    clearTimeout(winTimer);
    if (game) { pauseTimer(); saveGame(); }
    mode = m; LS.set('mode', m);
    clearHints(); closeModal('#winModal');
    game = loadGame(m) || freshPuzzle(m);
    if (game.solved && m !== 'daily') { game = freshPuzzle(m); }
    buildBoard(); updateTabDots(); saveGame();
  }
  for (const t of $$('.tab')) t.addEventListener('click', () => { if (t.dataset.mode !== mode) { buzz(6); switchMode(t.dataset.mode); } });

  // keyboard (desktop convenience)
  document.addEventListener('keydown', e => {
    const modal = $('.scrim.open');
    if (modal) {
      if (e.key === 'Escape') closeModal('#' + modal.id);
      if (e.key === 'Tab') {
        const buttons = $$('button:not([disabled])', modal), first = buttons[0], last = buttons[buttons.length - 1];
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
        e.preventDefault(); const j = Math.max(0, Math.min(n * n - 1, i + moves[e.key]));
        cell.tabIndex = -1; cellEls[j].tabIndex = 0; cellEls[j].focus(); return;
      }
      const key = e.key.toLowerCase();
      if ([' ', 'enter', 'd', 'x', 'delete', 'backspace'].includes(key)) {
        e.preventDefault(); tapCell(i, key === 'd' ? (game.cells[i] === 2 ? 0 : 2) : key === 'x' ? (game.cells[i] === 1 ? 0 : 1) : ['delete', 'backspace'].includes(key) ? 0 : undefined); return;
      }
    }
    if (e.key === 'z' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); $('#btnUndo').click(); }
    if (e.key === 'h') showHint();
    if (e.key === 'Escape') for (const s of $$('.scrim.open')) closeModal('#' + s.id);
  });

  // ---------- boot ----------
  switchMode(mode);
  renderInput();
  if (!settings.seenHelp) setTimeout(() => openModal('#helpModal'), 400);
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => { /* offline support unavailable */ }));
  }
})();
