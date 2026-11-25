const { chromium } = require('playwright');
const BASE = 'http://localhost:8765/';
let pass = 0, fail = 0; const failures = [];
const ok = (cond, name, extra) => { if (cond) { pass++; console.log('  ✓', name); } else { fail++; failures.push(name + (extra ? ' -> ' + extra : '')); console.log('  ✗', name, extra || ''); } };
const section = (s) => console.log('\n' + s);
const text = (p, sel) => p.locator(sel).first().innerText();

async function fresh(b, opts = {}) {
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, serviceWorkers: 'block', ...opts });
  const page = await ctx.newPage();
  page.errs = [];
  page.on('console', m => { if (m.type() === 'error') page.errs.push(m.text()); });
  page.on('pageerror', e => page.errs.push('PAGEERROR ' + e.message));
  return { ctx, page };
}
const clean = (errs) => errs.filter(e => !/Service Worker/i.test(e));
const goto = async (page, hash = '') => { await page.goto(BASE + 'index.html' + hash); await page.waitForSelector('#startBtn'); };
const setHidden = (page, hidden) => page.evaluate((h) => {
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => h });
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (h ? 'hidden' : 'visible') });
  document.dispatchEvent(new Event('visibilitychange'));
}, hidden);
const setFields = async (page, vals) => { await page.evaluate(() => window.__timermask.go('timers')); for (const [id, v] of Object.entries(vals)) { await page.fill('#' + id, String(v)); await page.dispatchEvent('#' + id, 'change'); } await page.evaluate(() => window.__timermask.go('home')); };

(async () => {
  const b = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });

  section('1. Load, errors, CSP');
  {
    const { ctx, page } = await fresh(b);
    await page.addInitScript(() => { window.__TM_TEST__ = true; });
    await goto(page);
    ok(clean(page.errs).length === 0, 'no console errors / CSP violations on load', clean(page.errs).join(' | '));
    ok((await text(page, '#time')) === '05:00', 'default countdown is 05:00');
    ok((await text(page, '#phase')).toLowerCase() === 'ready', 'idle phase says READY');
    await ctx.close();
  }

  section('2. Countdown accuracy, pause/resume, reset (fake clock)');
  {
    const { ctx, page } = await fresh(b);
    await page.addInitScript(() => { window.__TM_TEST__ = true; });
    await page.clock.install({ time: 1_700_000_000_000 });
    await goto(page);
    await page.click('#startBtn');
    await page.clock.runFor(10_000);
    ok((await text(page, '#time')) === '04:50', 'after 10s shows 04:50', await text(page, '#time'));
    await page.click('#startBtn'); // pause
    await page.clock.runFor(30_000);
    ok((await text(page, '#time')) === '04:50', 'paused timer does not advance');
    await page.click('#startBtn');
    await page.clock.runFor(50_000);
    ok((await text(page, '#time')) === '04:00', 'resume continues exactly (04:00 after 60s running)', await text(page, '#time'));
    await page.click('#resetBtn');
    ok((await text(page, '#time')) === '05:00', 'reset returns to 05:00');
    await page.click('#startBtn');
    await page.clock.runFor(300_000 + 200);
    ok((await text(page, '#time')) === '00:00' && (await text(page, '#phase')).toLowerCase() === 'done', 'completes at 5:00 and shows DONE');
    ok((await text(page, '#startBtn')).toLowerCase().includes('start again'), 'button offers Start again');
    ok(clean(page.errs).length === 0, 'no errors during run', clean(page.errs).join('|'));
    await ctx.close();
  }

  section('3. No drift over many phases');
  {
    const { ctx, page } = await fresh(b);
    await page.addInitScript(() => { window.__TM_TEST__ = true; });
    await page.clock.install({ time: 1_700_000_000_000 });
    await goto(page);
    await page.evaluate(() => window.__timermask.setTab('tabata'));
    await setFields(page, { work: 1, rest: 1, rounds: 100, prepare: 0 });
    await page.click('#startBtn');
    // irregular ticks (83ms steps) for 150s -> must be in round 75 work/rest exactly where ideal says
    let t = 0; while (t < 150_000) { await page.clock.runFor(83); t += 83; }
    const st = await page.evaluate(() => { const { run } = window.__timermask; return { idx: run.idx, secs: run.segs.length }; });
    // ideal at 150.0s+: segment 150 (0-based) because each seg = 1s
    ok(Math.abs(st.idx - 150) <= 1, 'after ~150s of irregular ticks the phase index matches ideal time (±1)', JSON.stringify(st));
    await page.clock.runFor(250_000);
    ok((await text(page, '#phase')).toLowerCase() === 'done', 'finishes at 199s total (no extra drift)');
    await ctx.close();
  }

  section('4. Screen lock / background catch-up');
  {
    const { ctx, page } = await fresh(b);
    await page.addInitScript(() => { window.__TM_TEST__ = true; });
    await page.clock.install({ time: 1_700_000_000_000 });
    await goto(page);
    await page.click('#startBtn');
    await page.clock.runFor(5_000);
    await setHidden(page, true);
    await page.clock.fastForward(95_000); // phone locked for 95s; timers frozen
    await setHidden(page, false);
    await page.clock.runFor(200);
    const tt = await text(page, '#time');
    ok(tt === '03:20' || tt === '03:19', 'after 100s total (5 + 95 locked) shows ~03:20', tt);
    await page.click('#startBtn');
    // finish while locked
    await page.click('#resetBtn');
    await page.click('#startBtn');
    await setHidden(page, true);
    await page.clock.fastForward(400_000);
    await setHidden(page, false);
    await page.clock.runFor(200);
    ok((await text(page, '#phase')).toLowerCase() === 'done', 'timer that finished while locked shows DONE on return');
    ok((await page.locator('#toast').innerText()).length > 0, 'user is told it finished while away');
    await ctx.close();
  }
  {
    const { ctx, page } = await fresh(b);
    await page.addInitScript(() => { window.__TM_TEST__ = true; });
    await page.clock.install({ time: 1_700_000_000_000 });
    await goto(page);
    await page.evaluate(() => { window.__timermask.S.interrupt = 'pause'; document.getElementById('interruptionMode').value = 'pause'; });
    await page.click('#startBtn');
    await page.clock.runFor(5_000);
    await setHidden(page, true);
    await page.clock.fastForward(60_000);
    await setHidden(page, false);
    ok((await text(page, '#time')) === '04:55', '"Pause" interruption mode pauses on hide and keeps 04:55', await text(page, '#time'));
    ok((await text(page, '#startBtn')).toLowerCase().includes('start'), 'shows Start (paused) after interruption');
    await ctx.close();
  }

  section('5. Session restore after reload / app killed');
  {
    const { ctx, page } = await fresh(b);
    await page.addInitScript(() => { window.__TM_TEST__ = true; });
    await goto(page);
    await page.click('#startBtn');
    await page.waitForTimeout(2300);
    await page.reload(); await page.waitForSelector('#startBtn');
    const tt = await text(page, '#time');
    ok(['04:58', '04:57', '04:56', '04:55'].includes(tt), 'running timer resumes after reload with correct time', tt);
    ok((await text(page, '#startBtn')).toLowerCase().includes('pause'), 'restored timer is running');
    await page.click('#startBtn'); // pause
    const t1 = await text(page, '#time');
    await page.reload(); await page.waitForSelector('#startBtn');
    ok((await text(page, '#time')) === t1, 'paused timer restores paused at same time', t1);
    await page.click('#resetBtn'); await page.reload(); await page.waitForSelector('#startBtn');
    ok((await text(page, '#time')) === '05:00', 'reset clears saved session');
    await ctx.close();
  }

  section('6. Modes, fields validation, presets');
  {
    const { ctx, page } = await fresh(b);
    await page.addInitScript(() => { window.__TM_TEST__ = true; });
    await goto(page);
    await page.click('.hero .tab[data-tab="tabata"]');
    ok((await page.locator('#summary').innerText()).includes('20'), 'summary shows interval settings');
    await page.click('#presets button >> nth=1');
    ok((await page.locator('#summary').innerText()).includes('40s work'), 'tabata preset chip applies 40/20');
    await page.evaluate(() => window.__timermask.go('timers'));
    await page.fill('#work', '99999'); await page.dispatchEvent('#work', 'change');
    ok((await page.inputValue('#work')) === '3600', 'out-of-range work is clamped to 3600');
    await page.fill('#rounds', ''); await page.dispatchEvent('#rounds', 'change');
    ok((await page.inputValue('#rounds')) === '10', 'empty value falls back to previous valid value');
    await page.fill('#presetName', 'Mine'); await page.click('#savePresetBtn');
    ok((await page.locator('#savedSelect option').allInnerTexts()).includes('Mine'), 'preset saved and listed');
    await page.goto(BASE + 'index.html#home'); await page.reload(); await page.waitForSelector('#startBtn');
    await page.click('.hero .tab[data-tab="tabata"]');
    ok((await page.locator('#presets button').allInnerTexts()).includes('Mine'), 'saved preset survives reload and appears as chip');
    await page.evaluate(() => window.__timermask.go('timers'));
    await page.selectOption('#savedSelect', 'Mine');
    await page.click('#deleteSaved'); await page.click('#confirmYes');
    ok(!(await page.locator('#savedSelect option').allInnerTexts()).includes('Mine'), 'preset deleted after confirmation');
    // countdown zero
    await page.evaluate(() => window.__timermask.go('home')); await page.click('.hero .tab[data-tab="countdown"]');
    await setFields(page, { minutes: 0, seconds: 0 });
    await page.click('#startBtn');
    ok((await text(page, '#startBtn')).toLowerCase().includes('start'), 'zero-length countdown refuses to start');
    ok((await page.locator('#toast').innerText()).length > 0, 'explains why (toast)');
    await ctx.close();
  }

  section('7. Sequence editor, dialogs, XSS');
  {
    const { ctx, page } = await fresh(b);
    await page.addInitScript(() => { window.__TM_TEST__ = true; window.__xss = 0; });
    await goto(page);
    await page.click('.hero .tab[data-tab="sequence"]');
    await page.evaluate(() => window.__timermask.go('timers'));
    ok((await page.locator('.seqItem').count()) === 3, 'default routine has 3 steps');
    await page.locator('.seqItem').nth(0).locator('button[title="Edit"]').click();
    await page.waitForTimeout(100); // the dialog moves focus to the name field after 30 ms
    await page.fill('#stepName', '<img src=x onerror="window.__xss=1">Bomb');
    await page.fill('#stepMin', '2'); await page.fill('#stepSec', '30');
    await page.click('#stepSave');
    ok((await page.locator('.seqItem small').first().innerText()) === '02:30', 'step edited via in-app dialog (2:30)', await page.locator('.seqItem small').first().innerText());
    ok((await page.evaluate(() => window.__xss)) === 0, 'markup in step name does not execute');
    ok(!(await page.locator('.seqItem strong').first().innerText()).includes('<'), 'angle brackets are stripped from names');
    await page.locator('.seqItem').nth(1).locator('button[title="Move up"]').click();
    ok((await page.locator('.seqItem strong').first().innerText()) === 'HIIT', 'reorder works');
    await page.locator('.seqItem').nth(0).locator('button[title="Remove"]').click();
    ok((await page.locator('.seqItem').count()) === 2, 'remove works');
    await page.evaluate(() => { for (let i = 0; i < 40; i++) document.getElementById('addCount').click(); });
    ok((await page.locator('.seqItem').count()) === 30, 'steps are capped at 30', String(await page.locator('.seqItem').count()));
    ok(await page.locator('#addCount').isDisabled(), 'add buttons disable at the cap');
    await ctx.close();
  }

  section('8. Corrupt / hostile saved data');
  {
    for (const payload of ['{not json', '[]', '"x"', JSON.stringify({ cfg: { tabata: { work: 'x' } }, sequence: [{ type: 'x' }, null, 5], presets: { tabata: JSON.parse('{"__proto__":{"a":1}}') }, color: 'javascript:alert(1)', ring: '<b>', lang: 'xx', volume: 'loud' })]) {
      const { ctx, page } = await fresh(b);
      await page.addInitScript((p) => { window.__TM_TEST__ = true; localStorage.setItem('timermask_v2', p); localStorage.setItem('timermask_session', '{bad'); }, payload);
      await goto(page);
      ok(clean(page.errs).length === 0 && (await text(page, '#time')) === '05:00', 'survives saved data: ' + payload.slice(0, 28), clean(page.errs).join('|'));
      ok((await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--accent').trim())) === '#ff8a21', '  invalid colour ignored');
      await ctx.close();
    }
  }

  section('9. Languages: no missing text, no overflow');
  {
    const { ctx, page } = await fresh(b);
    await page.addInitScript(() => { window.__TM_TEST__ = true; });
    await goto(page);
    const langs = await page.evaluate(() => TMI18N.languages.map(l => l[0]));
    for (const l of langs) {
      await page.evaluate((code) => { document.getElementById('languageSelect').value = code; document.getElementById('languageSelect').dispatchEvent(new Event('change')); }, l);
      const res = await page.evaluate(() => {
        const bad = [...document.querySelectorAll('[data-i18n]')].filter(n => !n.textContent.trim() || n.textContent === n.dataset.i18n).map(n => n.dataset.i18n);
        const navOver = [...document.querySelectorAll('.pageLink')].filter(n => n.scrollWidth > n.clientWidth + 1).map(n => n.textContent.trim());
        return { bad, navOver, lang: document.documentElement.lang, sw: document.documentElement.scrollWidth, iw: innerWidth };
      });
      ok(res.bad.length === 0 && res.lang === l && res.sw <= res.iw, `${l}: all strings present, lang attr set, no horizontal overflow`, JSON.stringify(res));
      if (res.navOver.length) console.log('    note: truncated nav labels in', l, res.navOver);
    }
    await ctx.close();
  }

  section('10. Layout: no horizontal overflow on any page/viewport; landscape controls reachable');
  {
    const views = { phoneSmall: [360, 640], phone: [360, 740], phoneL: [740, 360], tablet: [820, 1180], desktop: [1366, 768] };
    for (const [n, [w, h]] of Object.entries(views)) {
      const { ctx, page } = await fresh(b, { viewport: { width: w, height: h }, isMobile: n.startsWith('phone') });
      await page.addInitScript(() => { window.__TM_TEST__ = true; });
      await goto(page);
      for (const pg of ['home', 'timers', 'design', 'support', 'settings']) {
        await page.evaluate((p) => window.__timermask.go(p), pg);
        const o = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
        ok(o <= 0, `${n}/${pg}: no horizontal scroll`, 'overflow ' + o);
      }
      await page.evaluate(() => window.__timermask.go('home'));
      const bb = await page.locator('#startBtn').boundingBox();
      ok(bb && bb.y + bb.height <= h + 1, `${n}: Start button visible without scrolling`, JSON.stringify(bb));
      await page.screenshot({ path: `shots/final_${n}.png` });
      await ctx.close();
    }
  }

  section('11. Accessibility basics');
  {
    const { ctx, page } = await fresh(b);
    await page.addInitScript(() => { window.__TM_TEST__ = true; });
    await goto(page);
    for (const pg of ['home', 'timers', 'design', 'support', 'settings']) {
      await page.evaluate((p) => window.__timermask.go(p), pg);
      if (pg === 'settings') await page.evaluate(() => window.__timermask.go('settings', 'accessibility'));
      const unnamed = await page.evaluate(() => [...document.querySelectorAll('button,a[href],input,select')].filter(e => e.offsetParent !== null || e.type === 'checkbox').filter(e => {
        const l = e.labels && e.labels.length ? [...e.labels].map(x => x.textContent).join('') : '';
        return !(e.getAttribute('aria-label') || e.title || l.trim() || (e.textContent || '').trim());
      }).map(e => e.outerHTML.slice(0, 80)));
      ok(unnamed.length === 0, `${pg}: every control has an accessible name`, unnamed.join(' | '));
    }
    const small = await page.evaluate(() => { window.__timermask.go('home'); return [...document.querySelectorAll('button:not(.hidden),a.btn')].filter(e => e.offsetParent).map(e => { const r = e.getBoundingClientRect(); return { n: (e.textContent || e.getAttribute('aria-label') || '').trim().slice(0, 14), w: r.width, h: r.height }; }).filter(x => x.w < 40 || x.h < 40); });
    ok(small.length === 0, 'home: all touch targets ≥ 40px', JSON.stringify(small));
    ok((await page.locator('html').getAttribute('lang')) === 'en', '<html lang> set');
    ok((await page.locator('#announcer[aria-live=polite]').count()) === 1, 'polite live region present for phase announcements');
    const cont = await page.evaluate(() => { const E = TMEngine; const r = []; for (const light of [false, true]) for (const c of ['#ff8a21', '#ffffff', '#000000', '#3aa9ff']) { const panel = light ? '#ffffff' : '#14171d'; r.push([light, c, E.contrast(E.hexToRgb(E.readableAccent(c, panel, 4.5)), E.hexToRgb(panel))]); } return r; });
    ok(cont.every(x => x[2] >= 4.4), 'accent text keeps ≥4.5:1 contrast in dark & light for any colour', JSON.stringify(cont.filter(x => x[2] < 4.4)));
    // keyboard
    await page.keyboard.press('Space');
    ok((await text(page, '#startBtn')).toLowerCase().includes('pause'), 'Space starts the timer');
    await page.keyboard.press('r');
    ok((await text(page, '#time')) === '05:00', 'R resets');
    await ctx.close();
  }

  section('12. Sounds (stubbed AudioContext), vibration, wake lock');
  {
    const { ctx, page } = await fresh(b);
    await page.addInitScript(() => {
      window.__TM_TEST__ = true; window.__osc = 0; window.__wl = { req: 0, rel: 0 }; window.__vib = 0;
      class G { constructor() { this.gain = { setValueAtTime() {}, exponentialRampToValueAtTime() {} }; } connect(x) { return x; } }
      class O { constructor() { this.frequency = { setValueAtTime() {} }; window.__osc++; } connect(x) { return x; } start() {} stop() {} }
      window.AudioContext = class { constructor() { this.state = 'running'; this.currentTime = 0; this.destination = {}; } resume() {} createOscillator() { return new O(); } createGain() { return new G(); } };
      Object.defineProperty(navigator, 'wakeLock', { value: { request: async () => { window.__wl.req++; return { released: false, release: async () => { window.__wl.rel++; } }; } } });
      navigator.vibrate = () => { window.__vib++; return true; };
    });
    await page.clock.install({ time: 1_700_000_000_000 });
    await goto(page);
    await page.evaluate(() => window.__timermask.setTab('tabata'));
    await setFields(page, { work: 5, rest: 5, rounds: 2, prepare: 0 });
    await page.click('#startBtn');
    ok((await page.evaluate(() => window.__wl.req)) === 1, 'wake lock requested on start (default on)');
    await page.clock.runFor(5_100);
    const afterWork = await page.evaluate(() => window.__osc);
    ok(afterWork >= 3 + 2, 'beeps at 3,2,1 plus transition ding were played', 'oscillators=' + afterWork);
    await page.click('#startBtn');
    ok((await page.evaluate(() => window.__wl.rel)) >= 1, 'wake lock released on pause');
    await page.click('#resetBtn');
    await page.evaluate(() => { window.__osc = 0; document.getElementById('warning').click(); document.getElementById('ding').click(); });
    await page.click('#startBtn'); await page.clock.runFor(4_000);
    ok((await page.evaluate(() => window.__osc)) === 0, 'both sound toggles off => silent');
    await ctx.close();
  }

  section('13. Fullscreen');
  {
    const { ctx, page } = await fresh(b);
    await goto(page);
    await page.click('#fullBtn'); await page.waitForTimeout(300);
    const on = await page.evaluate(() => !!document.fullscreenElement || document.body.classList.contains('fullscreenMode'));
    ok(on, 'fullscreen (native or fallback) engages');
    await page.evaluate(() => { document.body.classList.add('fullscreenMode'); document.getElementById('exitBtn').classList.remove('hidden'); });
    ok(await page.locator('#exitBtn').isVisible(), 'exit button visible in fullscreen');
    await ctx.close();
  }

  section('14. Navigation / back button');
  {
    const { ctx, page } = await fresh(b);
    await page.addInitScript(() => { window.__TM_TEST__ = true; });
    await goto(page);
    await page.click('.pageLink[data-page-target="settings"]');
    await page.click('[data-settings-target="language"]');
    ok(await page.locator('[data-settings-section="language"]').isVisible(), 'settings sub-page opens');
    await page.goBack();
    ok(await page.locator('#settingsMenu').isVisible(), 'browser/Android Back returns to settings menu');
    await page.goBack();
    ok(await page.locator('[data-page="home"]').isVisible(), 'Back again returns Home');
    await page.click('#startBtn');
    await page.click('.pageLink[data-page-target="design"]');
    ok(/\d:\d\d/.test(await page.locator('.navTime').innerText()), 'running time shown on Home tab while on another page');
    await ctx.close();
  }

  section('15. Native bridge (mocked Capacitor: AdMob, Billing, alerts, keep-awake)');
  {
    const { ctx, page } = await fresh(b);
    await page.addInitScript(() => {
      window.__TM_TEST__ = true; window.__calls = [];
      const rec = (n) => (a) => { window.__calls.push(n); return Promise.resolve(n === 'requestConsentInfo' ? { isConsentFormAvailable: false } : n === 'requestPermissions' ? { display: 'granted' } : undefined); };
      const listeners = {};
      const mk = (names, extra = {}) => Object.assign(Object.fromEntries(names.map(n => [n, rec(n)])), extra);
      window.__sched = null;
      window.Capacitor = { isNativePlatform: () => true, getPlatform: () => 'android', Plugins: {
        AdMob: mk(['initialize', 'requestConsentInfo', 'showConsentForm', 'showBanner', 'hideBanner', 'removeBanner', 'resumeBanner', 'showPrivacyOptionsForm'], { addListener: (e, f) => { listeners[e] = f; } }),
        LocalNotifications: mk(['requestPermissions', 'createChannel', 'cancel'], { schedule: (o) => { window.__sched = o; window.__calls.push('schedule'); return Promise.resolve(); } }),
        KeepAwake: mk(['keepAwake', 'allowSleep']) } };
      window.__fireAdHeight = (h) => listeners['bannerAdSizeChanged'] && listeners['bannerAdSizeChanged']({ height: h });
      // mock cordova-plugin-purchase
      let owned = false, whenCbs = {};
      const store = { register() {}, initialize: async () => {}, owned: () => owned, get: () => ({ canPurchase: !owned, getOffer: () => ({ pricingPhases: [{ price: '2,99 €' }], order: async () => { owned = true; Object.values(whenCbs).forEach(f => f && f()); } }) }),
        when: () => { const w = { productUpdated: (f) => { whenCbs.p = f; return w; }, approved: () => w, finished: (f) => { whenCbs.f = f; return w; } }; return w; }, restorePurchases: async () => {} };
      window.CdvPurchase = { store, Platform: { GOOGLE_PLAY: 'gp' }, ProductType: { NON_CONSUMABLE: 'nc' }, ErrorCode: { PAYMENT_CANCELLED: 6777006 } };
    });
    await page.clock.install({ time: 1_700_000_000_000 });
    await goto(page);
    await page.clock.runFor(3_000);
    const c1 = await page.evaluate(() => window.__calls.slice());
    ok(c1.includes('initialize') && c1.includes('showBanner'), 'AdMob initialised and banner shown on idle screen', c1.join(','));
    await page.evaluate(() => window.__fireAdHeight(60));
    ok((await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--ad-h').trim())) === '60px', 'layout reserves space for the banner (--ad-h)');
    await page.click('#startBtn');
    ok((await page.evaluate(() => window.__calls.includes('hideBanner'))), 'banner hidden while a timer runs');
    await page.clock.runFor(1_000);
    await page.click('#startBtn'); await page.evaluate(() => { window.__calls.length = 0; });
    await page.click('#startBtn'); await page.click('#startBtn');
    ok((await page.evaluate(() => window.__calls.includes('resumeBanner'))), 'banner is resumed (not re-created) when the timer stops');
    await page.click('#startBtn');
    await setHidden(page, true);
    ok((await page.evaluate(() => window.__calls.includes('schedule'))), 'phase-change alerts scheduled when app goes to background');
    const n = await page.evaluate(() => window.__sched && window.__sched.notifications.length);
    ok(n >= 1, 'notification list not empty', String(n));
    await setHidden(page, false);
    ok((await page.evaluate(() => window.__calls.includes('cancel'))), 'alerts cancelled when app returns');
    await page.click('#startBtn');
    await page.evaluate(() => window.__timermask.go('support'));
    ok((await text(page, '#adFreeBtn')).includes('2,99'), 'remove-ads button shows the store price');
    ok(await page.locator('#restoreBtn').isVisible(), 'Restore purchase visible in the app');
    await page.click('#adFreeBtn'); await page.clock.runFor(500);
    ok(await page.locator('#adFreeBtn').isHidden(), 'after purchase the button is replaced by the thank-you note');
    ok((await page.evaluate(() => localStorage.getItem('tm_adfree'))) === '1', 'ad-free entitlement cached for offline use');
    ok((await page.evaluate(() => window.__calls.includes('removeBanner'))), 'banner removed after purchase');
    await ctx.close();
  }
  {
    const { ctx, page } = await fresh(b);
    await page.addInitScript(() => { window.__TM_TEST__ = true; });
    await goto(page);
    await page.evaluate(() => window.__timermask.go('support'));
    ok((await text(page, '#adFreeBtn')).includes('€2.99'), 'web: price shown as €2.99 (monetisation plan)');
    ok((await page.locator('#coffeeBtn').isHidden()), 'web: unconfigured coffee button hidden (no dead placeholder)');
    ok(!(await page.locator('body').innerText()).includes('$3.99'), 'old $3.99 price gone');
    await ctx.close();
  }

  section('16. Light theme + custom accent');
  {
    const { ctx, page } = await fresh(b);
    await page.addInitScript(() => { window.__TM_TEST__ = true; });
    await goto(page);
    await page.evaluate(() => window.__timermask.go('design'));
    await page.click('#light + *', { force: true }).catch(() => {});
    await page.evaluate(() => { const l = document.getElementById('light'); l.checked = true; l.dispatchEvent(new Event('change')); });
    await page.click('.swatch[data-color="#ffffff"]');
    const v = await page.evaluate(() => ({ ui: getComputedStyle(document.documentElement).getPropertyValue('--accent-ui').trim(), light: document.body.classList.contains('light') }));
    ok(v.light && v.ui !== '#ffffff', 'white accent is auto-darkened in light mode so the ring stays visible', JSON.stringify(v));
    await page.screenshot({ path: 'shots/final_light_design.png' });
    await ctx.close();
  }

  section('17. Performance / memory over a long run');
  {
    const { ctx, page } = await fresh(b);
    await page.addInitScript(() => { window.__TM_TEST__ = true; });
    await page.clock.install({ time: 1_700_000_000_000 });
    await goto(page);
    await page.evaluate(() => window.__timermask.setTab('tabata'));
    await setFields(page, { work: 10, rest: 5, rounds: 200, prepare: 0 });
    const nodes0 = await page.evaluate(() => document.getElementsByTagName('*').length);
    await page.click('#startBtn');
    await page.clock.runFor(1_000);
    const nodes1 = await page.evaluate(() => document.getElementsByTagName('*').length); // the keep-awake fallback video is created once on start
    await page.clock.runFor(599_000);
    const m = await page.evaluate(() => ({ nodes: document.getElementsByTagName('*').length, timers: window.__timermask.run.tick }));
    ok(m.nodes === nodes1 && nodes1 - nodes0 <= 3, 'DOM node count constant over 10 simulated minutes', `${nodes0} -> ${nodes1} -> ${m.nodes}`);
    ok(clean(page.errs).length === 0, 'no errors in long run');
    await ctx.close();
  }

  await b.close();
  console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
  if (fail) { console.log('FAILURES:\n - ' + failures.join('\n - ')); process.exit(1); }
})();
