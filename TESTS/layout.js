// Geometry tests on phone-sized screens: digits inside the ring, landscape layout, fixed header, Start on Timers page.
const { chromium } = require('playwright');
const BASE = 'http://localhost:8765/index.html';
let pass = 0, fail = 0;
const ok = (c, n, x) => { if (c) { pass++; console.log('  ✓', n); } else { fail++; console.log('  ✗', n, x || ''); } };
const views = { 'phone 360x640': [360, 640], 'phone 360x740': [360, 740], 'phone 412x915': [412, 915], 'phone 320x568': [320, 568], 'landscape 740x360': [740, 360], 'landscape 800x360': [800, 360], 'landscape 640x320': [640, 320], 'landscape 915x412': [915, 412], 'tablet 820x1180': [820, 1180], 'desktop 1366x768': [1366, 768] };
async function digitsInside(p) {
  return p.evaluate(() => {
    const dial = document.getElementById('dial').getBoundingClientRect(), t = document.getElementById('time');
    const r = document.createRange(); r.selectNodeContents(t); const tr = r.getBoundingClientRect();
    const fs = parseFloat(getComputedStyle(t).fontSize), h = fs * 0.75;
    const cx = dial.left + dial.width / 2, cy = dial.top + dial.height / 2;
    const dbl = document.getElementById('dial').classList.contains('double');
    const inner = dial.width * ((dbl ? 111 - 1.5 : 126 - 4.5) / 300) ;
    const mid = (tr.top + tr.bottom) / 2;
    let worst = 0;
    for (const x of [tr.left, tr.right]) for (const y of [mid - h / 2, mid + h / 2]) worst = Math.max(worst, Math.hypot(x - cx, y - cy));
    return { worst, inner, dial: dial.width, fs };
  });
}
(async () => {
  const b = await chromium.launch();
  for (const [name, [w, h]] of Object.entries(views)) {
    console.log('\n' + name);
    const ctx = await b.newContext({ viewport: { width: w, height: h }, hasTouch: true, isMobile: w < 900, serviceWorkers: 'block' });
    const p = await ctx.newPage(); const errs = [];
    p.on('pageerror', e => errs.push(e.message));
    await p.addInitScript(() => { window.__TM_TEST__ = true; });
    await p.goto(BASE + '#home'); await p.waitForSelector('#startBtn');
    // 1. digits inside ring, for every ring style, normal and large digits, short and long time strings
    let bad = '';
    for (const large of [false, true]) for (const ring of ['classic', 'double', 'dashed', 'arc', 'minimal']) for (const secs of [5 * 60, 3725, 100 * 60]) {
      await p.evaluate(([l, r, s]) => {
        document.body.classList.toggle('largeDigits', l); document.getElementById('dial').className = 'dial ' + r;
        const t = document.getElementById('time'); const E = TMEngine; const txt = E.format(s); t.textContent = txt;
        let em = 0; for (const ch of txt) em += (ch === ':' ? 0.3 : 0.64) - 0.075; t.style.setProperty('--tw', Math.max(2, em).toFixed(3));
      }, [large, ring, secs]);
      const g = await digitsInside(p);
      const limit = g.inner - 2;
      if (ring !== 'minimal' && g.worst > limit) bad += `[${large ? 'large ' : ''}${ring} ${secs}s: ${g.worst.toFixed(0)}>${limit.toFixed(0)}] `;
    }
    ok(!bad, 'digits stay inside the ring (all styles, large digits, hours)', bad);
    await p.reload(); await p.waitForSelector('#startBtn');
    // 2. Start visible without scrolling on Home, header + nav stay put
    const sb = await p.locator('#startBtn').boundingBox();
    ok(sb && sb.y >= 0 && sb.y + sb.height <= h, 'Start button fully visible on Home', JSON.stringify(sb));
    const land = w > h && h <= 520;
    if (land) {
      const d = await p.locator('#dial').boundingBox();
      ok(d.width >= h * 0.7, 'landscape: dial is big (' + Math.round(d.width) + 'px of ' + h + ')', d.width);
      ok(d.x + d.width / 2 < w * 0.55, 'landscape: dial on the left');
      ok(sb.x > d.x + d.width, 'landscape: buttons on the right of the dial');
      const rs = await p.evaluate(() => { const r = document.getElementById('dial').getBoundingClientRect(); const t = document.getElementById('time').getBoundingClientRect(); return t.left >= r.left && t.right <= r.right; });
      ok(rs, 'landscape: numbers inside the dial box');
    }
    // 3. scrolling pages: header never moves
    await p.evaluate(() => window.__timermask.go('settings'));
    await p.evaluate(() => { document.querySelector('[data-settings-target="accessibility"]').click(); });
    await p.evaluate(() => window.__timermask.go('timers'));
    const st0 = await p.locator('#startFromTimers').boundingBox();
    ok(st0 && st0.y >= 0 && st0.y + st0.height <= h + 1, 'Start button visible on Timers page without scrolling', JSON.stringify(st0));
    const top0 = await p.locator('.top').boundingBox();
    await p.evaluate(() => { document.getElementById('main').scrollTop = 99999; });
    const top1 = await p.locator('.top').boundingBox();
    const docScroll = await p.evaluate(() => document.scrollingElement.scrollTop + window.scrollY);
    ok(top0.y === top1.y && docScroll === 0, 'header stays fixed while the Timers page scrolls', JSON.stringify([top0, top1, docScroll]));
    const nav = await p.locator('#pageNav').boundingBox();
    ok(nav.y >= 0 && nav.y + nav.height <= h + 1 && nav.x >= 0 && nav.x + nav.width <= w + 1, 'navigation fully on screen', JSON.stringify(nav));
    // 4. Start on Timers page
    const st = await p.locator('#startFromTimers').boundingBox();
    ok(st && st.y + st.height <= h + 1 && st.y >= 0, 'Start button visible on Timers page (sticky)', JSON.stringify(st));
    ok(await p.locator('#fullBtn').isHidden(), 'Fullscreen button hidden on Timers page');
    await p.click('#startFromTimers');
    await p.waitForTimeout(150);
    ok(await p.evaluate(() => document.body.dataset.current === 'home' && /pause/i.test(document.getElementById('startBtn').textContent)), 'Start on Timers page starts the timer and shows Home');
    ok(await p.evaluate(() => /total/i.test(document.getElementById('summary').textContent)), 'Home shows summary with total time', await p.locator('#summary').innerText());
    ok(await p.locator('.kbdTip').count() === 0, 'keyboard-shortcut tip removed');
    ok(errs.length === 0, 'no JS errors', errs.join('|'));
    await p.screenshot({ path: `shots/lay_${name.replace(/[^a-z0-9]+/gi, '_')}.png` });
    await ctx.close();
  }
  await b.close();
  console.log(`\nRESULT: ${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
})();
