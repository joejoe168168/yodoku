const {chromium}=require('./.qa/node_modules/playwright');
const sharp=require('./.qa/node_modules/sharp');
const fs=require('fs'),http=require('http'),assert=require('assert/strict');
(async()=>{
 for(const [file,size] of [['icon-192.png',192],['icon-512.png',512],['apple-touch-icon.png',180]]) await sharp('icons/icon.svg').resize(size,size).png().toFile('icons/'+file);
 await sharp('icons/icon.svg').resize(400,400).extend({top:56,bottom:56,left:56,right:56,background:'#FAF8EF'}).png().toFile('icons/icon-maskable-512.png');
 const server=http.createServer((req,res)=>{const path='.'+(req.url==='/'?'/index.html':req.url.split('?')[0]);try{res.setHeader('Content-Type',path.endsWith('.js')?'text/javascript':path.endsWith('.svg')?'image/svg+xml':path.endsWith('.png')?'image/png':path.endsWith('.json')?'application/json':'text/html');res.end(fs.readFileSync(path));}catch{res.statusCode=404;res.end();}}).listen(8080,'127.0.0.1');
 const browser=await chromium.launch({channel:'msedge',headless:true});
 try{
 const context=await browser.newContext({viewport:{width:1440,height:1000}});const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://127.0.0.1:8080');await page.getByRole('button',{name:"Let's go!"}).click();
 const cell=page.locator('.cell');
 await page.locator('[data-tool="dino"]').click();await cell.nth(0).click();assert.equal(await page.locator('.dino').count(),1);assert.equal(await page.locator('.x').count(),0);
 await page.locator('[data-tool="x"]').click();await cell.nth(10).click();
 await page.locator('#btnAutoX').click();assert.ok(await page.locator('.auto').count()>0);
 await page.locator('#btnAutoX').click();assert.equal(await page.locator('.x').count(),1);assert.equal(await cell.nth(10).getAttribute('data-v'),'x');
 await page.reload();await page.locator('#btnUndo').click();assert.equal(await page.locator('.auto').count(),0);assert.equal(await page.locator('.x').count(),0);
 await cell.nth(0).focus();await page.keyboard.press('ArrowRight');await page.keyboard.press('d');assert.equal(await cell.nth(1).getAttribute('data-v'),'dino');
 await page.locator('#btnClear').click();await page.locator('[data-tool="dino"]').click();await cell.nth(16).click();
 await page.waitForTimeout(2400);await page.screenshot({path:'preview-desktop.png',fullPage:true});
 await page.locator('#btnSettings').click();await page.keyboard.press('Escape');assert.equal(await page.locator('.scrim.open').count(),0);
 for(const [width,height] of [[390,844],[320,568],[768,1024],[844,390]]){
  await page.setViewportSize({width,height});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  const b=await page.locator('#board').boundingBox();assert.ok(b.width>=270);await page.screenshot({path:`preview-${width}.png`,fullPage:true});
 }
 const mobile=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});const mp=await mobile.newPage();await mp.goto('http://127.0.0.1:8080');await mp.getByRole('button',{name:"Let's go!"}).tap();await mp.locator('[data-tool="dino"]').tap();await mp.locator('.cell').nth(0).tap();assert.equal(await mp.locator('.dino').count(),1);assert.equal(await mp.locator('.x').count(),0);
 await page.setViewportSize({width:390,height:844});await page.locator('#btnClear').click();await page.locator('[data-tool="x"]').click();
 const a=await cell.nth(0).boundingBox(),b=await cell.nth(3).boundingBox();await page.mouse.move(a.x+a.width/2,a.y+a.height/2);await page.mouse.down();await page.mouse.move(b.x+b.width/2,b.y+b.height/2,{steps:20});await page.mouse.up();assert.equal(await page.locator('.x').count(),4);await page.locator('#btnUndo').click();assert.equal(await page.locator('.x').count(),0);
 // Rule feedback is immediate, persistent, and does not reveal legal-but-wrong placements.
 await page.locator('[data-tool="dino"]').click();await cell.nth(0).click();await cell.nth(1).click();
 assert.equal(await page.locator('.cell.err').count(),2);assert.match(await page.locator('#feedbackMessage').innerText(),/share row 1/);assert.equal(await page.locator('#settledProgress').getAttribute('aria-valuenow'),'0');
 await page.waitForTimeout(2000);assert.match(await page.locator('#feedbackMessage').innerText(),/share row 1/);assert.equal(await page.locator('.reaction').count(),0);
 await page.screenshot({path:'preview-conflict-mobile.png',fullPage:true});await page.locator('#btnFeedbackUndo').click();assert.equal(await page.locator('.cell.err').count(),0);
 await page.locator('#btnClear').click();const puzzle=await page.evaluate(()=>JSON.parse(localStorage.getItem('yodoku.game.normal')).puzzle);
 const wrong=(puzzle.sol[0]+1)%puzzle.n;await cell.nth(wrong).click();assert.equal(await page.locator('.cell.err').count(),0);
 await page.locator('#btnSettings').click();await page.locator('[data-setting="checkSolution"]').click();await page.locator('[data-setting="patterns"]').click();await page.locator('#btnSettingsClose').click();assert.equal(await page.locator('.cell.err').count(),1);assert.match(await page.locator('#feedbackMessage').innerText(),/solution spot/);assert.equal(await page.locator('.board.patterns').count(),1);
 await page.reload();assert.equal(await page.locator('.board.patterns').count(),1);assert.equal(await page.locator('.cell.err').count(),1);
 await page.locator('#btnSettings').click();await page.locator('[data-setting="checkSolution"]').click();await page.locator('[data-setting="showErrors"]').click();await page.locator('#btnSettingsClose').click();await page.locator('#btnClear').click();
 for(let i=0;i<puzzle.n;i++)await cell.nth(i).click();assert.match(await page.locator('#feedbackMessage').innerText(),/Nearly home/);assert.equal(await page.locator('.cell.err').count(),puzzle.n);await page.locator('#btnClear').click();
 await page.locator('#btnHint').click();assert.match(await page.locator('#hintTitle').innerText(),/1\/3/);assert.equal(await page.locator('.hint-focus').count(),0);await page.locator('#btnHintMore').click();assert.match(await page.locator('#hintTitle').innerText(),/2\/3/);assert.equal(await page.locator('.hint-focus').count(),0);await page.locator('#btnHintMore').click();assert.ok(await page.locator('.hint-focus').count()>0);await page.screenshot({path:'preview-hint-mobile.png',fullPage:true});await page.locator('#btnHintDismiss').click();assert.equal(await page.locator('.hint-focus').count(),0);
 // Tutorial is separate from the player's saved state and works with touch.
 const before=await mp.evaluate(()=>localStorage.getItem('yodoku.game.normal'));await mp.locator('#btnHelp').tap();await mp.locator('#btnTutorial').tap();await mp.locator('#practiceBoard button').nth(1).tap();await mp.locator('#btnTutorialNext').tap();await mp.locator('#practiceBoard button').nth(0).tap();await mp.locator('#btnTutorialNext').tap();await mp.screenshot({path:'preview-tutorial-mobile.png',fullPage:true});await mp.locator('#practiceBoard button').nth(6).tap();await mp.locator('#btnTutorialNext').tap();for(const i of [7,8,14])await mp.locator('#practiceBoard button').nth(i).tap();assert.match(await mp.locator('#tutorialStatus').innerText(),/Everyone/);await mp.locator('#btnTutorialNext').tap();assert.equal(await mp.evaluate(()=>localStorage.getItem('yodoku.game.normal')),before);
 await page.setViewportSize({width:320,height:568});await page.locator('#btnHint').click();assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.locator('#btnHintMore').click();await page.locator('#btnHintMore').click();await page.locator('#btnHintDismiss').click();
 await page.emulateMedia({reducedMotion:'reduce'});for(let r=0;r<puzzle.n;r++)await cell.nth(r*puzzle.n+puzzle.sol[r]).click();await page.locator('#winModal.open').waitFor();assert.equal(await page.locator('.board.won').count(),1);assert.equal(await page.locator('#confetti.hidden').count(),1);assert.equal(await page.locator('.dino use[href="#yo-happy"]').count(),puzzle.n);
 const Y=require('./engine');for(const [kind,pair] of [['row',[0,1]],['column',[0,4]],['diagonal',[0,5]],['region',[0,2]]]){const cells=Array(16).fill(0);pair.forEach(i=>cells[i]=2);assert.ok(Y.conflictDetails(4,Array(16).fill(0),cells).some(issue=>issue.kind===kind));}
 assert.deepEqual(errors,[]);console.log('PASS: existing controls, responsive/touch layouts, rule explanations, full invalid board, optional solution checking, patterns, graduated hints, independent touch tutorial, valid progress, reduced-motion celebration, all conflict types, no JS errors.');
 }finally{await browser.close();server.close();}
})().catch(e=>{console.error(e);process.exit(1)});
