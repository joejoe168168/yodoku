const assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
(async () => {
  const events = {}, stores = new Map(), location = new URL('https://yodoku.test/sw.js');
  let release = 'installed-release', requests = 0, claimed = false;
  class LocalRequest extends Request { constructor(url, options) { super(new URL(url, location), options); } }
  const fetch = async req => { requests++; return new Response(release + ':' + (req.url || req)); };
  const caches = {
    async open(name) {
      if (!stores.has(name)) stores.set(name, new Map());
      const map = stores.get(name);
      return {
        async addAll(reqs) { for (const req of reqs) { assert.equal(req.cache, 'reload'); map.set(req.url, await fetch(req)); } },
        async match(req) { return map.get(req.url || req)?.clone(); },
        async put(req, res) { map.set(req.url || req, res); }
      };
    },
    async keys() { return [...stores.keys()]; },
    async delete(name) { return stores.delete(name); },
    async match(req) { for (const name of stores.keys()) { const result = await (await this.open(name)).match(req); if (result) return result; } }
  };
  stores.set('other-app-cache', new Map()); stores.set('yodoku-v4', new Map());
  const self = { location, addEventListener: (name, fn) => events[name] = fn, skipWaiting: async () => {}, clients: { claim: async () => { claimed = true; } } };
  vm.runInNewContext(fs.readFileSync('sw.js','utf8'), { self, location, caches, fetch, Request: LocalRequest, Response, URL });
  let work; events.install({waitUntil: promise => work = promise}); await work;
  events.activate({waitUntil: promise => work = promise}); await work;
  assert.ok(claimed); assert.ok(stores.has('other-app-cache')); assert.ok(!stores.has('yodoku-v4'));
  release = 'next-release'; const before = requests;
  for (const path of ['app.js','engine.js','index.html','manifest.json']) {
    let response; events.fetch({request:new LocalRequest(path),respondWith:promise=>response=promise});
    assert.match(await (await response).text(),/^installed-release:/);
  }
  assert.equal(requests,before,'cached scripts must not be individually replaced with the next release');
  let intercepted=false;events.fetch({request:new LocalRequest('unrelated.txt'),respondWith:()=>intercepted=true});assert.equal(intercepted,false);
  console.log('PASS: offline release stays internally consistent; install bypasses stale HTTP cache; unrelated caches and requests are preserved.');
})().catch(e=>{console.error(e);process.exitCode=1});
