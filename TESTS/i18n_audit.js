// Finds English text left in other languages: (1) dictionary values identical to English, (2) visible text in the DOM that is still English.
const { chromium } = require('playwright'); const I = require('../web/i18n.js');
const en = I.dict.en; const SAME_OK = new Set(['YouTube','Countdown','Tabata / HIIT','Focus','Total','Design','Timer','Ding','Start','Install','Menu','OK','Classic','Minimal','Ticks','Arc','Double','Support']);
(async () => {
  let bad = 0;
  for (const [code] of I.languages) { if (code === 'en') continue; const d = I.dict[code]; const same = Object.keys(en).filter(k => d[k] === en[k] && !SAME_OK.has(en[k]) && en[k].length > 3 && !/^\W*$/.test(en[k]) && !/^[{}\w\s·%:./-]*$/.test(en[k].replace(/[A-Za-z]{2,}/g, m => (/^(min|sec)$/i.test(m) ? m : 'X')))); if (same.length) { console.log(code, 'identical to English:', same.join(', ')); bad += same.length; } }
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 900, height: 700 }, serviceWorkers: 'block' }); const p = await ctx.newPage();
  await p.addInitScript(() => { window.__TM_TEST__ = true; });
  const enWords = new Set(); for (const v of Object.values(en)) for (const w of String(v).toLowerCase().match(/[a-z]{4,}/g) || []) enWords.add(w);
  for (const [code] of I.languages) { if (code === 'en') continue;
    await p.addInitScript((c) => { localStorage.setItem('timermask_v2', JSON.stringify({ lang: c })); }, code).catch(() => {});
    await p.goto('http://localhost:8765/index.html'); await p.evaluate((c) => { const s = JSON.parse(localStorage.getItem('timermask_v2') || '{}'); s.lang = c; localStorage.setItem('timermask_v2', JSON.stringify(s)); }, code); await p.reload(); await p.waitForSelector('#startBtn');
    const found = new Set();
    for (const pg of ['home', 'timers', 'design', 'support', 'settings']) {
      await p.evaluate((x) => window.__timermask.go(x), pg);
      for (const sub of pg === 'settings' ? ['language', 'interruptions', 'accessibility', 'installation'] : [null]) {
        if (sub) await p.evaluate((s) => window.__timermask.go('settings', s), sub);
        const texts = await p.evaluate(() => { const out = []; const w = document.createTreeWalker(document.getElementById('main'), NodeFilter.SHOW_TEXT); while (w.nextNode()) { const n = w.currentNode; const el = n.parentElement; if (!el || el.closest('.hidden,[hidden],select,option,script,style') || !el.offsetParent) continue; const t = n.textContent.trim(); if (t) out.push(t); } document.querySelectorAll('[aria-label],[title],input[placeholder]').forEach(e => { if (e.offsetParent) ['aria-label', 'title', 'placeholder'].forEach(a => { const v = e.getAttribute(a); if (v) out.push(v); }); }); return out; });
        for (const t of texts) { const ws = t.toLowerCase().match(/[a-z]{4,}/g) || []; if (ws.length && ws.every(w => enWords.has(w)) && !/^(timermask|youtube|tabata|hiit|http)/i.test(t) && !/^[A-Za-z]{1,4}$/.test(t)) found.add(`${pg}${sub ? '/' + sub : ''}: ${t.slice(0, 70)}`); }
      }
    }
    // dynamic bits
    if (found.size) { console.log(code, 'English-looking text on screen:\n  ' + [...found].join('\n  ')); bad += found.size; }
  }
  await b.close(); console.log('\nRESULT:', bad ? bad + ' suspicious strings' : 'all clean'); })();
