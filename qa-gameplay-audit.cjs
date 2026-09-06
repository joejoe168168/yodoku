const { chromium } = require('./.qa/node_modules/playwright');
const fs = require('node:fs'), http = require('node:http'), assert = require('node:assert/strict');
const Y = require('./engine');
(async () => {
  const server = http.createServer((req, res) => {
    const path = '.' + (req.url === '/' ? '/index.html' : req.url.split('?')[0]);
    try { res.setHeader('Content-Type', path.endsWith('.js') ? 'text/javascript' : path.endsWith('.svg') ? 'image/svg+xml' : path.endsWith('.json') ? 'application/json' : path.endsWith('.png') ? 'image/png' : 'text/html'); res.end(fs.readFileSync(path)); }
    catch { res.statusCode = 404; res.end(); }
  }).listen(8081, '127.0.0.1');
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const failures = [], passed = [];
  const p = Y.generate({ difficulty: 'normal', seed: 0 });
  const save = (puzzle = p, extra = {}) => ({ puzzle, seed: puzzle.seed, cells: Array(puzzle.n ** 2).fill(0), autoOwner: Array(puzzle.n ** 2).fill(-1), history: [], elapsed: 0, hints: 0, solved: false, ...extra });
  function almostSolved(puzzle, extra = {}) { const cells=Array(puzzle.n**2).fill(0);puzzle.sol.slice(0,-1).forEach((c,r)=>cells[r*puzzle.n+c]=2);return save(puzzle,{cells,elapsed:12000,...extra}); }
  const dailyPuzzle=Y.generate({difficulty:Y.dailyDifficulty('2026-09-06'),size:Y.dailySize('2026-09-06'),seed:Y.dailySeed('2026-09-06')});
  const dailyAlmost=almostSolved(dailyPuzzle,{dateStr:'2026-09-06'});
  async function run(name, test, data = {}) {
    if (process.env.AUDIT_ONLY && !name.includes(process.env.AUDIT_ONLY)) return;
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, timezoneId: 'Asia/Hong_Kong', reducedMotion: 'reduce' });
    const page = await context.newPage(); page.setDefaultTimeout(4000); const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.clock.install({ time: new Date('2026-09-06T12:00:00+08:00') });
    await page.addInitScript(d => {
      if (sessionStorage.getItem('auditInitialized')) return;
      sessionStorage.setItem('auditInitialized', 'yes');
      for (const [key, value] of Object.entries(d)) localStorage.setItem('yodoku.' + key, JSON.stringify(value));
    }, { settings: { seenHelp: true, manualDefaultV2: true, autoX: false, tool: 'dino', sound: false, haptics: false }, 'game.normal': save(), ...data });
    try { await page.goto('http://127.0.0.1:8081'); await test(page, context); assert.deepEqual(errors, []); passed.push(name); }
    catch (e) { failures.push(name + ': ' + e.message.split('\n').slice(0, 4).join(' ') + (errors.length ? ' | browser errors: ' + errors.join('; ') : '')); }
    finally { await context.close(); }
  }
  const state = (page, mode = 'normal') => page.evaluate(m => JSON.parse(localStorage.getItem('yodoku.game.' + m)), mode);
  const tick = (page, ms) => page.clock.runFor(ms);
  try {
    await run('timer resumes when returning to a mode', async page => {
      await page.locator('.cell').nth(0).click(); await tick(page, 2000);
      await page.locator('[data-mode="easy"]').click(); await page.locator('[data-mode="normal"]').click(); await tick(page, 3500);
      const seconds = Number((await page.locator('#timer').textContent()).split(':')[1]); assert.ok(seconds >= 5 && seconds <= 6);
    });
    await run('hint-only progress resumes after reload', async page => {
      await page.locator('#btnHint').click(); await tick(page, 2000); await page.reload(); await tick(page, 3000);
      assert.equal(await page.locator('#timer').textContent(), '00:05');
    });
    await run('fast drag paints every crossed square and undoes as one move', async page => {
      await page.locator('[data-tool="x"]').click(); const cells = page.locator('.cell');
      const a = await cells.nth(0).boundingBox(), b = await cells.nth(6).boundingBox();
      await page.mouse.move(a.x+a.width/2,a.y+a.height/2); await page.mouse.down(); await page.mouse.move(b.x+b.width/2,b.y+b.height/2,{steps:1}); await page.mouse.up();
      assert.equal(await page.locator('.x').count(),7); await page.locator('#btnUndo').click(); assert.equal(await page.locator('.x').count(),0);
    });
    await run('undo respects currently enabled Auto X', async page => {
      await page.locator('.cell').nth(0).click(); await page.locator('.cell').nth(10).click();
      await page.locator('#btnAutoX').click(); await page.locator('#btnUndo').click();
      const s = await state(page); for (const i of Y.coverage(p.n,p.region,0)) assert.equal(s.cells[i],1);
    });
    await run('New confirmation belongs to one puzzle', async page => {
      await page.locator('.cell').nth(0).click(); await page.locator('#btnNew').click();
      await page.locator('[data-mode="easy"]').click(); await page.locator('.cell').nth(0).click(); const before = await state(page,'easy');
      await page.locator('#btnNew').click(); assert.equal((await state(page,'easy')).seed,before.seed);
    });
    await run('malformed move history does not crash undo', async page => {
      assert.ok(await page.locator('#btnUndo').isDisabled());await page.locator('.cell').nth(0).click();await page.locator('#btnUndo').click(); assert.equal(await page.locator('.cell').count(),49);assert.equal(await page.locator('.dino').count(),0);
    }, { 'game.normal': save(p,{ history:[{}] }) });
    await run('solved flag cannot freeze an incomplete Daily', async page => {
      assert.equal(await page.locator('#btnHint').isEnabled(),true);
    }, { mode:'daily', 'game.daily':save(Y.generate({difficulty:Y.dailyDifficulty('2026-09-06'),size:Y.dailySize('2026-09-06'),seed:Y.dailySeed('2026-09-06')}),{dateStr:'2026-09-06',solved:true}) });
    await run('finishing across midnight credits the puzzle date', async page => {
      await page.clock.setSystemTime(new Date('2026-09-07T00:00:01+08:00'));
      const s = await state(page,'daily'); const r=s.puzzle.n-1;await page.locator('.cell').nth(r*s.puzzle.n+s.puzzle.sol[r]).click();
      const stats=await page.evaluate(()=>JSON.parse(localStorage.getItem('yodoku.stats')));
      assert.equal(stats.daily.lastDate,'2026-09-06');
      assert.match(await page.locator('#btnNew').textContent(),/Today/);
      await page.locator('#btnNew').click(); assert.equal((await state(page,'daily')).dateStr,'2026-09-07');await tick(page,1500);assert.equal(await page.locator('#winModal.open').count(),0);
    }, (()=>{const puzzle=Y.generate({difficulty:Y.dailyDifficulty('2026-09-06'),size:Y.dailySize('2026-09-06'),seed:Y.dailySeed('2026-09-06')});const cells=Array(puzzle.n**2).fill(0);puzzle.sol.slice(0,-1).forEach((c,r)=>cells[r*puzzle.n+c]=2);return {mode:'daily','game.daily':save(puzzle,{dateStr:'2026-09-06',cells})};})());
    await run('legacy Daily streak is preserved',async page=>{
      await page.locator('.cell').nth((dailyPuzzle.n-1)*dailyPuzzle.n+dailyPuzzle.sol.at(-1)).click();
      const stats=await page.evaluate(()=>JSON.parse(localStorage.getItem('yodoku.stats')));assert.equal(stats.daily.streak,4);assert.equal(stats.daily.solved,4);
    },{mode:'daily','game.daily':dailyAlmost,stats:{daily:{lastDate:'2026-09-05',streak:3,solved:3,best:5000}}});
    await run('replaying a completed Daily cannot inflate statistics',async page=>{
      await page.locator('.cell').nth((dailyPuzzle.n-1)*dailyPuzzle.n+dailyPuzzle.sol.at(-1)).click();
      const stats=await page.evaluate(()=>JSON.parse(localStorage.getItem('yodoku.stats')));assert.equal(stats.daily.streak,1);assert.equal(stats.daily.solved,1);assert.equal(stats.daily.best,50000);
    },{mode:'daily','game.daily':dailyAlmost,stats:{daily:{lastDate:'2026-09-06',streak:1,solved:1,best:50000,completedDates:['2026-09-06']}}});
    await run('timer excludes dialogs and hidden-tab time',async page=>{
      await page.locator('.cell').nth(0).click();await tick(page,2000);await page.locator('#btnSettings').click();await tick(page,5000);assert.equal(await page.locator('#timer').textContent(),'00:02');await page.locator('#btnSettingsClose').click();
      await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,get:()=>true});document.dispatchEvent(new Event('visibilitychange'));});await tick(page,5000);
      await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,get:()=>false});document.dispatchEvent(new Event('visibilitychange'));});await tick(page,2500);assert.match(await page.locator('#timer').textContent(),/00:0[45]/);
    });
    await run('clock corrections cannot add an hour to solve time',async page=>{
      await page.locator('.cell').nth(0).click();await page.clock.setSystemTime(new Date('2026-09-06T13:00:00+08:00'));await tick(page,2500);assert.match(await page.locator('#timer').textContent(),/00:0[23]/);
    });
    await run('overlapping Auto X keeps manual notes and remaining coverage',async page=>{
      const a=p.sol[0],b=p.n+p.sol[1],manual=[...Y.coverage(p.n,p.region,a)].find(i=>i!==b);
      await page.locator('[data-tool="x"]').click();await page.locator('.cell').nth(manual).click();await page.locator('[data-tool="dino"]').click();await page.locator('#btnAutoX').click();await page.locator('.cell').nth(a).click();await page.locator('.cell').nth(b).click();await page.locator('.cell').nth(a).click();
      const s=await state(page);assert.equal(s.cells[manual],1);assert.equal(s.autoOwner[manual],-1);for(const i of Y.coverage(p.n,p.region,b))assert.equal(s.cells[i],1);await page.locator('#btnAutoX').click();assert.equal(await page.locator('.x').count(),1);
    });
    await run('notes and Auto X preference survive changing modes',async page=>{
      await page.locator('.cell').nth(0).click();await page.locator('[data-mode="easy"]').click();await page.locator('#btnAutoX').click();await page.locator('[data-mode="normal"]').click();assert.ok(await page.locator('.auto').count()>0);
      await page.locator('[data-mode="easy"]').click();await page.locator('#btnAutoX').click();await page.locator('[data-mode="normal"]').click();assert.equal(await page.locator('.auto').count(),0);assert.equal(await page.locator('.dino').count(),1);
    });
    await run('release outside the board does not place a dino',async page=>{
      const r=await page.locator('.cell').nth(0).boundingBox();await page.mouse.move(r.x+r.width/2,r.y+r.height/2);await page.mouse.down();await page.mouse.move(0,r.y+r.height/2);await page.mouse.up();assert.equal(await page.locator('.dino').count(),0);
    });
    await run('keyboard respects row edges and dialog shortcuts',async page=>{
      await page.locator('.cell').nth(7).focus();await page.keyboard.press('ArrowLeft');assert.equal(await page.evaluate(()=>document.activeElement.dataset.i),'7');await page.keyboard.press('d');await page.keyboard.press('Control+z');assert.equal(await page.locator('.dino').count(),0);await page.locator('#btnHelp').click();await page.keyboard.press('h');assert.equal((await state(page)).hints,0);await page.keyboard.press('Escape');
    });
    await run('share and clipboard fallback format the solved puzzle',async page=>{
      await page.evaluate(()=>{Object.defineProperty(navigator,'share',{configurable:true,value:async data=>{window.shared=data.text;}});Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>{window.copied=text;}}});});
      await page.locator('.cell').nth(6*7+p.sol[6]).click();await tick(page,1500);await page.locator('#btnShare').click();assert.match(await page.evaluate(()=>window.shared),/Yodoku Normal · Level 1 \(7×7\)/);assert.equal((await page.evaluate(()=>window.shared)).split('🦖').length-1,7);
      await page.evaluate(()=>{Object.defineProperty(navigator,'share',{configurable:true,value:async()=>{throw new DOMException('Cancelled','AbortError');}});});await page.locator('#btnShare').click();assert.equal(await page.evaluate(()=>window.copied),undefined);
      await page.evaluate(()=>{Object.defineProperty(navigator,'share',{configurable:true,value:undefined});});await page.locator('#btnShare').click();assert.equal(await page.evaluate(()=>window.copied),await page.evaluate(()=>window.shared));
    },{'game.normal':almostSolved(p)});
    await run('storage failure is reported without breaking gameplay',async page=>{
      await page.evaluate(()=>{const original=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if(k==='yodoku.game.normal')throw new DOMException('Full','QuotaExceededError');return original.call(this,k,v);};});await page.locator('.cell').nth(0).click();assert.equal(await page.locator('.dino').count(),1);assert.match(await page.locator('#toast').innerText(),/Saving is unavailable/);
    });
    await run('offline reload restores the game',async(page,context)=>{
      await page.evaluate(()=>navigator.serviceWorker.ready);await page.reload();await page.locator('.cell').nth(0).click();await context.setOffline(true);await page.reload();assert.equal(await page.locator('.dino').count(),1);assert.equal(await page.locator('.cell').count(),49);
    });
    await run('sound and haptic preferences gate their effects',async page=>{
      await page.evaluate(()=>{
        window.tones=0;window.buzzes=0;const Original=window.AudioContext;
        window.AudioContext=class extends Original{createOscillator(){window.tones++;return super.createOscillator();}};
        Object.defineProperty(navigator,'vibrate',{configurable:true,value:()=>{window.buzzes++;return true;}});
      });
      await page.locator('.cell').nth(0).click();assert.equal(await page.evaluate(()=>window.tones+window.buzzes),0);
      await page.locator('#btnSettings').click();await page.locator('[data-setting="sound"]').click();await page.locator('[data-setting="haptics"]').click();await page.locator('#btnSettingsClose').click();await page.locator('.cell').nth(0).click();assert.ok(await page.evaluate(()=>window.tones>0&&window.buzzes>0));
      await page.locator('#btnSettings').click();await page.locator('[data-setting="sound"]').click();await page.locator('[data-setting="haptics"]').click();await page.locator('#btnSettingsClose').click();const counts=await page.evaluate(()=>[window.tones,window.buzzes]);await page.locator('.cell').nth(0).click();assert.deepEqual(await page.evaluate(()=>[window.tones,window.buzzes]),counts);
    });
    await run('malformed cells and null statistics recover safely',async page=>{
      assert.equal(await page.locator('.cell').count(),49);assert.equal((await state(page)).cells.every(v=>v===0),true);await page.locator('#btnSettings').click();await page.locator('#settingsModal.open').waitFor();await page.locator('#statGrid').scrollIntoViewIfNeeded();await tick(page,250);assert.match(await page.locator('#statGrid').innerText(),/Normal solved/);
    },{stats:null,'game.normal':save(p,{cells:Array(49).fill('invalid')})});
    console.log(JSON.stringify({passed,failures},null,2)); if(failures.length)process.exitCode=1;
  } finally { await browser.close(); server.close(); }
})().catch(e=>{console.error(e);process.exit(1)});
