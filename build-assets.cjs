// Original vector exports, looping GIFs and synthesized PCM sound effects.
// npm install --prefix .qa sharp gifenc
const fs = require('node:fs');
const sharp = require('./.qa/node_modules/sharp');
const { GIFEncoder, quantize, applyPalette } = require('./.qa/node_modules/gifenc');
const html = fs.readFileSync('index.html', 'utf8');
const defs = html.match(/<defs>([\s\S]*?)<\/defs>/)[1];
const skins = ['yo', 'ko', 'pig'];
const background = skin => ({ yo: '#FAF8EF', ko: '#F0EEF6', pig: '#FFF0F4' })[skin];
const svg = (id, transform = '', background = '') => `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 100 100"><defs>${defs}</defs>${background ? `<rect width="100" height="100" rx="20" fill="${background}"/>` : ''}<g transform="${transform}"><use href="#${id}"/></g></svg>`;
fs.mkdirSync('assets/sounds', { recursive: true });

function makeWav(notes, duration, skin) {
  const rate = 22050, count = Math.ceil(duration * rate), bytes = Buffer.alloc(44 + count * 2);
  bytes.write('RIFF'); bytes.writeUInt32LE(36 + count * 2, 4); bytes.write('WAVEfmt ', 8); bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22); bytes.writeUInt32LE(rate, 24); bytes.writeUInt32LE(rate * 2, 28); bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34); bytes.write('data', 36); bytes.writeUInt32LE(count * 2, 40);
  for (let i = 0; i < count; i++) {
    const t = i / rate; let value = 0;
    for (const [frequency, start, length, volume = .3] of notes) {
      const u = t - start; if (u < 0 || u >= length) continue;
      const f = frequency * (skin === 'ko' ? .75 : skin === 'pig' ? 1.125 : 1);
      const phase = 2 * Math.PI * f * u + (skin === 'pig' ? .25 * Math.sin(u * 65) * Math.exp(-u * 16) : 0);
      const envelope = Math.min(1, u / .009) * Math.pow(1 - u / length, 2.5);
      const tone = Math.sin(phase) + (skin === 'ko' ? .14 : .24) * Math.sin(phase * 2) * Math.exp(-u * 20) + .06 * Math.sin(phase * 3);
      value += tone * envelope * volume;
    }
    bytes.writeInt16LE(Math.round(Math.max(-.9, Math.min(.9, value)) * 32767), 44 + i * 2);
  }
  return bytes;
}
const sounds = {
  x: { duration: .10, notes: [[660, 0, .09, .22]] },
  clear: { duration: .13, notes: [[392, 0, .11, .2]] },
  place: { duration: .33, notes: [[523.25, 0, .18], [783.99, .075, .22, .25]] },
  error: { duration: .24, notes: [[293.66, 0, .15, .22], [261.63, .07, .15, .2]] },
  hint: { duration: .46, notes: [[659.25, 0, .19, .24], [783.99, .10, .2, .23], [1046.5, .22, .22, .2]] },
  win: { duration: .98, notes: [[523.25, 0, .23], [659.25, .12, .23], [783.99, .24, .25], [1046.5, .4, .5, .28], [523.25, .42, .45, .1], [659.25, .42, .4, .1]] }
};

(async () => {
  for (const skin of skins) {
    for (const face of ['', '-happy', '-oops']) {
      const name = skin + (face || '-normal'), source = svg(skin + face);
      fs.writeFileSync(`assets/${name}.svg`, source);
      await sharp(Buffer.from(source)).png().toFile(`assets/${name}.png`);
    }
    const icon = svg(skin, 'translate(5 3) scale(.9)', background(skin));
    fs.writeFileSync(`assets/${skin}-icon.svg`, icon);
    await sharp(Buffer.from(icon)).resize(192).png().toFile(`assets/${skin}-icon.png`);
    for (const action of ['hello', 'celebrate']) {
      const gif = GIFEncoder();
      for (let frame = 0; frame < 20; frame++) {
        const phase = frame / 20 * Math.PI * 2;
        const y = action === 'celebrate' ? -Math.sin(frame / 20 * Math.PI) * 7 : -Math.sin(phase) * 1.2;
        const angle = action === 'hello' ? Math.sin(phase) * 7 : Math.sin(phase * 2) * 4;
        const source = svg(skin + (action === 'celebrate' ? '-happy' : ''), `translate(5 ${5 + y}) translate(45 45) rotate(${angle}) translate(-45 -45) scale(.9)`, background(skin));
        const rgba = await sharp(Buffer.from(source)).resize(192).ensureAlpha().raw().toBuffer();
        const palette = quantize(rgba, 96);
        gif.writeFrame(applyPalette(rgba, palette), 192, 192, { palette, delay: frame === 19 ? 850 : 65, repeat: 0 });
      }
      gif.finish(); fs.writeFileSync(`assets/${skin}-${action}.gif`, gif.bytes());
    }
    for (const [event, spec] of Object.entries(sounds)) fs.writeFileSync(`assets/sounds/${skin}-${event}.wav`, makeWav(spec.notes, spec.duration, skin));
  }
  const cards = skins.map(skin => `<section><h2>${skin === 'yo' ? 'Yo · Yodoku' : skin === 'ko' ? 'Ko · Kodoku' : 'Pip · Pigdoku'}</h2><div class="poses">${['normal','happy','oops'].map(face => `<figure><img src="${skin}-${face}.png" alt="${skin} ${face}" width="160" height="160"><figcaption>${face} · <a href="${skin}-${face}.svg">SVG</a> · <a href="${skin}-${face}.png">PNG</a></figcaption></figure>`).join('')}</div><div class="poses">${['hello','celebrate'].map(action => `<figure><picture><source media="(prefers-reduced-motion: reduce)" srcset="${skin}-${action === 'hello' ? 'normal' : 'happy'}.png"><img src="${skin}-${action}.gif" alt="${skin} ${action} animation" width="192" height="192"></picture><figcaption><a href="${skin}-${action}.gif">${action} GIF</a></figcaption></figure>`).join('')}</div><div class="sounds">${Object.keys(sounds).map(event => `<label>${event}<audio controls preload="none" src="sounds/${skin}-${event}.wav"></audio></label>`).join('')}</div></section>`).join('');
  fs.writeFileSync('assets/index.html', `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Yodoku, Kodoku & Pigdoku · Character collection</title><style>body{font:16px/1.5 system-ui;background:#FAF8EF;color:#354B42;max-width:920px;margin:0 auto;padding:24px}h1{font-size:30px}section{background:white;border-radius:24px;padding:20px;margin:24px 0}.poses{display:flex;flex-wrap:wrap;justify-content:center;gap:14px}figure{margin:6px;text-align:center}img{object-fit:contain;max-width:100%}a{color:#476451}audio{display:block;width:100%;margin:6px 0 16px}.sounds{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:16px;margin-top:24px}label{font-weight:600;text-transform:capitalize}@media(max-width:400px){body{padding:12px}section{padding:12px}.poses img{width:120px;height:120px}}</style><a href="../">← Back to the puzzle</a><h1>A little collection of friends</h1><p>Original character art, looping GIFs and gentle musical sounds. Tap a sound to listen. In the game, tap the logo or choose your friend in Settings.</p>${cards}<p>The game uses lightweight SVG/CSS animations and respects reduced motion. GIFs are reusable exports; audio never starts automatically.</p></html>`);
  const files = fs.readdirSync('assets').filter(n=>n!=='sounds');
  const total = files.reduce((sum,name)=>sum+fs.statSync('assets/'+name).size,0)+fs.readdirSync('assets/sounds').reduce((sum,name)=>sum+fs.statSync('assets/sounds/'+name).size,0);
  console.log(`Created ${files.length + skins.length * Object.keys(sounds).length} asset files; ${(total/1024).toFixed(0)} KiB total, including the optional gallery and GIF exports.`);
})().catch(e => { console.error(e); process.exitCode = 1; });
