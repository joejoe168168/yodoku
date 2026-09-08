// Run the production physics headlessly. Only input and audiovisual hooks are stubbed.
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const html = fs.readFileSync(__dirname + '/ember-tide.html', 'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
new vm.Script(script); // Also check syntax outside the extracted physics.
const Save={data:{ranks:{18:'A'},times:{18:63},unlocked:19},save(){this.saved=true;}};
const context = vm.createContext({console, Save, setTimeout:()=>{}, Audio:new Proxy({}, {get:()=>()=>{}}), UI:{toast(){}}, Game:{solo:false,active:'fire',levelComplete(){},onKey(){}}});
vm.runInContext(script.slice(script.indexOf('const T ='), script.indexOf('const $ =')) + '\n' +
 script.slice(script.indexOf('const LEVELS ='), script.indexOf('/* ------------------------- rendering')) +
 '\nglobalThis.api = {LEVELS, Level, Input, T};', context);
const {LEVELS,Level,Input,T}=context.api;
assert.equal(LEVELS.length,29);
assert.equal(Save.data.unlocked,20,'Completed original campaigns unlock level 20');
assert.equal(Save.data.ranks[18],'A');assert.equal(Save.data.times[18],63);assert.ok(Save.saved);
for(const [i,d] of LEVELS.entries()) {
 assert.equal(d.map.length,20,`Level ${i+1}: height`);
 for(const row of d.map){assert.equal(row.length,32);assert.match(row,/^[#.L~GFWfwrb]+$/);}
 for(const c of 'FWfw')assert.equal(d.map.join('').split(c).length-1,1,`${d.name}: ${c}`);
 assert.ok(d.par>0 && d.hint);
 for(const e of d.ents) if(e.t==='plat' && e.id)assert.ok(d.ents.some(t=>t.id===e.id&&(t.t==='button'||t.t==='lever')),`${d.name}: missing trigger ${e.id}`);
}
let level;
function tick(actions={}) {
 Input.down={};Input.pressed={};
 for(const [kind,c] of Object.entries(actions)){
  const keys=kind==='fire'?['ArrowLeft','ArrowRight','ArrowUp']:['KeyA','KeyD','KeyW'];
  if(c.dir)Input.down[keys[c.dir>0?1:0]]=true;
  if(c.jump){Input.down[keys[2]]=true;if(level[kind].onGround)Input.pressed[keys[2]]=true;}
 }
 level.update(1/60);
 assert.equal(level.deaths,0,`${level.def.name}: death at ${positions()}`);
}
function positions(){return level.players.map(p=>`${p.kind} (${((p.x+p.w/2)/T).toFixed(2)},${((p.y+p.h)/T).toFixed(2)})`).join(' ');}
function wait(n=60){for(let i=0;i<n;i++)tick();}
function until(test){for(let i=0;i<3600;i++){if(test())return;tick();}throw Error('Wait timed out '+positions());}
function go(kind,x,{jump=false,feet,limit=900}={}){
 const p=level[kind],target=x*T;
 for(let i=0;i<limit;i++){
  if(level.done)return;
  const delta=target-(p.x+p.w/2);
  if(Math.abs(delta)<5 && (!feet || Math.abs((p.y+p.h)/T-feet)<.12) && p.onGround){wait(8);return;}
  tick({[kind]:{dir:Math.abs(delta)<3?0:Math.sign(delta),jump}});
 }
 throw Error(`${level.def.name}: cannot reach ${kind} ${x},${feet}; ${positions()}`);
}
function ride(kind,x,feet){go(kind,x);for(let i=0;i<2400;i++){if(Math.abs((level[kind].y+level[kind].h)/T-feet)<.12)return;tick();}throw Error('Lift timed out '+positions());}
function finish(){assert.ok(level.done,`${level.def.name}: doors not occupied; ${positions()}`);assert.ok(level.gems.every(g=>g.got),`${level.def.name}: missed gems ${JSON.stringify(level.gems.filter(g=>!g.got))}`);assert.ok(level.time<level.def.par,`${level.def.name}: A rank must be achievable`);console.log(`${level.index+1} ${level.def.name}: all gems, both exits, ${level.time.toFixed(1)}s`);}
const routes = [
 ()=>{for(const k of ['fire','water']){go(k,5.8);for(const x of (k==='fire'?[9.5,15.5,19.5,24.5]:[10.5,14.5,20.5,24.5]))go(k,x,{jump:true});go(k,k==='fire'?27:29.5);}},
 ()=>{go('fire',5.5);go('water',16.5);go('fire',21);go('fire',24,{jump:true});go('fire',28.5);go('water',21);go('water',24,{jump:true});go('water',28.5);},
 ()=>{go('fire',6);go('fire',8.5,{jump:true,feet:16});go('fire',12.5);go('fire',18.5);go('fire',27.5);go('water',8.5);go('water',15.7);go('water',18.5,{jump:true,feet:16});go('water',23.5);go('water',29.5);},
 ()=>{for(const k of ['fire','water']){for(const y of [14,9,5]){ride(k,15,y);go(k,k==='fire'?20.5:23.5);if(y!==5)go(k,15);}go(k,k==='fire'?26.5:29.5);}},
 ()=>{for(const k of ['fire','water']){go(k,6);until(()=>level.plats[0].x===7*T&&level.plats[0].wait>1);go(k,9,{jump:true});until(()=>level.plats[0].x>=10.8*T);go(k,15.5,{jump:true,feet:17});go(k,16.5);until(()=>level.plats[1].x===18*T&&level.plats[1].wait>1);go(k,20,{jump:true});until(()=>level.plats[1].x>=22.8*T);go(k,27,{jump:true,feet:16});go(k,k==='fire'?27.5:29.5);}},
 ()=>{go('fire',9.6);wait(160);go('fire',13.5,{jump:true});go('fire',27.5);go('water',9);go('water',13.5,{jump:true});go('water',29.5);},
 ()=>{go('fire',5.5);go('water',22.5);go('fire',12.5);go('water',17.5);},
 ()=>{for(const k of ['fire','water']){go(k,7.5);go(k,12,{jump:true,feet:9});go(k,13.5);go(k,20,{jump:true,feet:13});go(k,21.5);go(k,27.5,{jump:true,feet:17});go(k,k==='fire'?27.5:29.5);}},
 ()=>{go('water',9.5);go('fire',5.5);ride('water',9.5,12);go('water',11.7);go('fire',7);go('water',14.5);ride('fire',7,12);go('fire',12,{jump:true,feet:12});go('fire',18);go('fire',21);go('fire',24,{jump:true});go('fire',26.5);go('water',21);go('water',24,{jump:true});go('water',29.5);},
 ()=>{for(const k of ['fire','water']){go(k,6);go(k,9.5,{jump:true});ride(k,12,12);go(k,18);go(k,21);until(()=>level.plats[2].y===12*T&&level.plats[2].wait>1);ride(k,24,5);go(k,k==='fire'?27.5:29.5);}}
];
for(let n=0;n<routes.length;n++){
 if(process.argv[2] && Number(process.argv[2])!==n+20)continue;
 level=new Level(LEVELS[n+19],n+19);wait(2);routes[n]();wait(5);finish();
}
