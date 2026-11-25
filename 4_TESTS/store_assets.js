const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 360, height: 640 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
  const p = await ctx.newPage();
  await p.addInitScript(() => { window.__TM_TEST__ = true; });
  await p.clock.install({ time: 1_700_000_000_000 });
  await p.goto('http://localhost:8765/index.html#home'); await p.waitForSelector('#startBtn');
  await p.screenshot({ path: 'store/phone_1_home.png' });
  await p.click('.hero .tab[data-tab="tabata"]'); await p.click('#presets button >> nth=0'); await p.click('#startBtn');
  await p.clock.runFor(26_000); await p.screenshot({ path: 'store/phone_2_tabata_running.png' });
  await p.click('#startBtn'); await p.click('#resetBtn');
  await p.click('.hero .tab[data-tab="sequence"]'); await p.evaluate(() => window.__timermask.go('timers')); await p.waitForTimeout(100);
  await p.screenshot({ path: 'store/phone_3_sequence_builder.png' });
  await p.evaluate(() => window.__timermask.go('design')); await p.click('.ringChoice[data-ring="dashed"]'); await p.click('.swatch[data-color="#3aa9ff"]');
  await p.screenshot({ path: 'store/phone_4_design.png' });
  await p.click('.swatch[data-color="#ff8a21"]'); await p.click('.ringChoice[data-ring="classic"]');
  await p.evaluate(() => window.__timermask.go('settings', 'language')); await p.screenshot({ path: 'store/phone_5_languages.png' });
  await ctx.close();
  // feature graphic 1024x500
  const c2 = await b.newContext({ viewport: { width: 1024, height: 500 }, deviceScaleFactor: 1 });
  const q = await c2.newPage();
  await q.goto('http://localhost:8765/index.html');
  await q.setContent(`<style>body{margin:0;width:1024px;height:500px;background:radial-gradient(ellipse at 20% 30%,#ff8a2133,transparent 55%),#090b0e;display:flex;align-items:center;gap:56px;padding:0 90px;box-sizing:border-box;font-family:Inter,system-ui,sans-serif;color:#fff}
  img{width:260px;height:260px;border-radius:44px}h1{margin:0;font-size:78px;letter-spacing:.1em}p{margin:14px 0 0;font-size:34px;color:#ff8a21;font-weight:700;letter-spacing:.04em}small{display:block;margin-top:18px;font-size:22px;color:#9aa2af}</style>
  <img src="http://localhost:8765/logo-header.png"><div><h1>TIMERMASK</h1><p>Your time. Your rules.</p><small>Countdown · Tabata · HIIT · Focus · Sequences</small></div>`);
  await q.waitForTimeout(400); await q.screenshot({ path: 'store/feature_graphic_1024x500.png' });
  await b.close();
})();
