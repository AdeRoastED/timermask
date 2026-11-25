/* TimerMask app logic (UI + persistence). Timer maths lives in engine.js; native features in native.js. */
(() => {
  'use strict';
  const E = window.TMEngine, I18N = window.TMI18N, N = window.TMNative, CFG = window.TM_CONFIG || {};
  const $ = (id) => document.getElementById(id);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const MODES = ['countdown', 'tabata', 'focus', 'sequence'];
  const PAGES = ['home', 'timers', 'design', 'support', 'settings'];
  const SUBS = ['language', 'interruptions', 'accessibility', 'installation'];
  const KEY = 'timermask_v2', SKEY = 'timermask_session';
  const CIRC = 2 * Math.PI * 126;

  /* ------------------------------------------------------------------ storage */
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); return true; } catch (e) { return false; } },
    del(k) { try { localStorage.removeItem(k); } catch (e) { /* ignore */ } }
  };
  function loadSaved() {
    try { const o = JSON.parse(store.get(KEY) || '{}'); return o && typeof o === 'object' && !Array.isArray(o) ? o : {}; } catch (e) { return {}; }
  }
  const saved = loadSaved();
  const legacyBool = (k) => store.get('tm_' + k) === 'true';
  const validHex = (c) => typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c);

  const S = {
    tab: MODES.includes(saved.tab) ? saved.tab : 'countdown',
    ring: ['classic', 'dashed', 'double', 'arc', 'minimal'].includes(saved.ring) ? saved.ring : 'classic',
    color: validHex(saved.color) ? saved.color.toLowerCase() : '#ff8a21',
    light: !!saved.light,
    cfg: E.sanitizeCfg(saved.cfg),
    sequence: Array.isArray(saved.sequence) ? E.sanitizeSequence(saved.sequence) : E.DEFAULT_SEQUENCE(),
    presets: {
      countdown: E.sanitizePresetMap(saved.presets && saved.presets.countdown, 'countdown'),
      tabata: E.sanitizePresetMap(saved.presets && saved.presets.tabata, 'tabata'),
      focus: E.sanitizePresetMap(saved.presets && saved.presets.focus, 'focus'),
      sequence: E.sanitizePresetMap(saved.routines, 'sequence')
    },
    volume: E.clamp(saved.volume === undefined ? 65 : saved.volume, 0, 100, 65),
    warning: saved.warning === undefined ? true : !!saved.warning,
    ding: saved.ding === undefined ? true : !!saved.ding,
    wake: saved.wake === undefined ? true : !!saved.wake,
    lang: null,
    interrupt: ['continue', 'pause'].includes(saved.interrupt) ? saved.interrupt : (['continue', 'pause'].includes(store.get('tm_interrupt')) ? store.get('tm_interrupt') : 'continue'),
    reduceMotion: saved.reduceMotion === undefined ? legacyBool('reduceMotion') : !!saved.reduceMotion,
    largeDigits: saved.largeDigits === undefined ? legacyBool('largeDigits') : !!saved.largeDigits,
    vibration: saved.vibration === undefined ? legacyBool('vibration') : !!saved.vibration
  };
  const wantedLang = saved.lang || store.get('tm_language') || (navigator.language || 'en');
  S.lang = I18N.detect(wantedLang);
  let t = I18N.make(S.lang);

  function persist() {
    store.set(KEY, JSON.stringify({
      tab: S.tab, ring: S.ring, color: S.color, light: S.light, cfg: S.cfg, sequence: S.sequence,
      presets: { countdown: S.presets.countdown, tabata: S.presets.tabata, focus: S.presets.focus },
      routines: S.presets.sequence,
      volume: S.volume, warning: S.warning, ding: S.ding, wake: S.wake, lang: S.lang, interrupt: S.interrupt,
      reduceMotion: S.reduceMotion, largeDigits: S.largeDigits, vibration: S.vibration
    }));
  }

  /* ------------------------------------------------------------------ small UI helpers */
  let toastTimer = 0;
  function toast(msg) {
    const el = $('toast');
    el.textContent = msg; el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 3200);
  }
  function announce(msg) {
    const a = $('announcer');
    a.textContent = '';
    setTimeout(() => { a.textContent = msg; }, 30);
  }
  function openDialog(d) { if (d.showModal) { if (!d.open) d.showModal(); } else d.setAttribute('open', ''); }
  function closeDialog(d) { if (d.close) d.close(); else d.removeAttribute('open'); }
  const kindKey = { countdown: 'phCountdown', prepare: 'phPrepare', work: 'phWork', rest: 'phRest', focus: 'phFocus', break: 'phBreak' };
  const DEFAULT_STEPS = { 'Warm-up': 'stepWarm', 'HIIT': 'stepHiit', 'Cooldown': 'stepCool' };
  const dn = (n) => (DEFAULT_STEPS[n] ? t(DEFAULT_STEPS[n]) : n);
  function phaseLabel(seg) {
    if (!seg) return t('ready');
    if (seg.label) return seg.round ? `${dn(seg.label)} · ${t('phWork')}` : dn(seg.label);
    return t(kindKey[seg.kind] || 'phCountdown');
  }
  function roundLabel(seg) {
    if (!seg || !seg.round) return '';
    return t(seg.round.type === 'cycle' ? 'cycleOf' : 'roundOf', { i: seg.round.i, n: seg.round.n });
  }

  /* ------------------------------------------------------------------ audio / haptics */
  let actx = null;
  function unlockAudio() {
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      actx = actx || new AC();
      if (actx.state !== 'running') actx.resume();
    } catch (e) { /* ignore */ }
  }
  function tone(freq, dur, delay, type) {
    if (!actx || S.volume <= 0) return;
    try {
      if (actx.state !== 'running') actx.resume();
      const t0 = actx.currentTime + (delay || 0), o = actx.createOscillator(), g = actx.createGain();
      o.type = type || 'sine';
      o.frequency.setValueAtTime(freq, t0);
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(Math.max(0.0001, (S.volume / 100) * 0.2), t0 + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      o.connect(g); g.connect(actx.destination);
      o.start(t0); o.stop(t0 + dur + 0.03);
    } catch (e) { /* ignore */ }
  }
  function buzz(pattern) { if (S.vibration && navigator.vibrate) { try { navigator.vibrate(pattern); } catch (e) { /* ignore */ } } }
  function ding() { if (S.ding) { tone(1050, 0.27, 0); tone(1450, 0.35, 0.09); } buzz([100, 60, 100]); }
  function finishChime() { tone(880, 0.35, 0); tone(1175, 0.35, 0.22); tone(1568, 0.7, 0.44); buzz([200, 100, 200, 100, 400]); }

  /* ------------------------------------------------------------------ wake lock */
  let wakeLock = null, wakeVideo = null, wakeWarned = false;
  const WAKE_MP4 = 'data:video/mp4;base64,AAAAIGZ0eXBpc29tAAACAGlzb21pc28yYXZjMW1wNDEAAAM1bW9vdgAAAGxtdmhkAAAAAAAAAAAAAAAAAAAD6AAAA+gAAQAAAQAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgAAAl90cmFrAAAAXHRraGQAAAADAAAAAAAAAAAAAAABAAAAAAAAA+gAAAAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAAABAAAAAQAAAAAAAkZWR0cwAAABxlbHN0AAAAAAAAAAEAAAPoAAAAAAABAAAAAAHXbWRpYQAAACBtZGhkAAAAAAAAAAAAAAAAAAAoAAAAKABVxAAAAAAALWhkbHIAAAAAAAAAAHZpZGUAAAAAAAAAAAAAAABWaWRlb0hhbmRsZXIAAAABgm1pbmYAAAAUdm1oZAAAAAEAAAAAAAAAAAAAACRkaW5mAAAAHGRyZWYAAAAAAAAAAQAAAAx1cmwgAAAAAQAAAUJzdGJsAAAAtnN0c2QAAAAAAAAAAQAAAKZhdmMxAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAABAAEABIAAAASAAAAAAAAAABFUxhdmM2MC4zMS4xMDIgbGlieDI2NAAAAAAAAAAAAAAAGP//AAAALGF2Y0MBQsAK/+EAFWdCwAraewEQAAADABAAAAMAoPEiagEABGjOPIAAAAAQcGFzcAAAAAEAAAABAAAAFGJ0cnQAAAAAAAAVoAAAFaAAAAAYc3R0cwAAAAAAAAABAAAABQAACAAAAAAUc3RzcwAAAAAAAAABAAAAAQAAABxzdHNjAAAAAAAAAAEAAAABAAAABQAAAAEAAAAoc3RzegAAAAAAAAAAAAAABQAAApAAAAAJAAAACQAAAAkAAAAJAAAAFHN0Y28AAAAAAAAAAQAAA2UAAABidWR0YQAAAFptZXRhAAAAAAAAACFoZGxyAAAAAAAAAABtZGlyYXBwbAAAAAAAAAAAAAAAAC1pbHN0AAAAJal0b28AAAAdZGF0YQAAAAEAAAAATGF2ZjYwLjE2LjEwMAAAAAhmcmVlAAACvG1kYXQAAAJ6BgX//3bcRem95tlIt5Ys2CDZI+7veDI2NCAtIGNvcmUgMTY0IHIzMTA4IDMxZTE5ZjkgLSBILjI2NC9NUEVHLTQgQVZDIGNvZGVjIC0gQ29weWxlZnQgMjAwMy0yMDIzIC0gaHR0cDovL3d3dy52aWRlb2xhbi5vcmcveDI2NC5odG1sIC0gb3B0aW9uczogY2FiYWM9MCByZWY9MSBkZWJsb2NrPTE6MDowIGFuYWx5c2U9MHgxOjB4MSBtZT1oZXggc3VibWU9MiBwc3k9MSBwc3lfcmQ9MS4wMDowLjAwIG1peGVkX3JlZj0wIG1lX3JhbmdlPTE2IGNocm9tYV9tZT0xIHRyZWxsaXM9MCA4eDhkY3Q9MCBjcW09MCBkZWFkem9uZT0yMSwxMSBmYXN0X3Bza2lwPTEgY2hyb21hX3FwX29mZnNldD0wIHRocmVhZHM9MSBsb29rYWhlYWRfdGhyZWFkcz0xIHNsaWNlZF90aHJlYWRzPTAgbnI9MCBkZWNpbWF0ZT0xIGludGVybGFjZWQ9MCBibHVyYXlfY29tcGF0PTAgc3RpdGNoYWJsZT0xIGNvbnN0cmFpbmVkX2ludHJhPTAgYmZyYW1lcz0wIHdlaWdodHA9MCBrZXlpbnQ9MjUwIGtleWludF9taW49NSBzY2VuZWN1dD00MCBpbnRyYV9yZWZyZXNoPTAgcmNfbG9va2FoZWFkPTEwIHJjPWNyZiBtYnRyZWU9MSBjcmY9MjMuMCBxY29tcD0wLjYwIHFwbWluPTAgcXBtYXg9NjkgcXBzdGVwPTQgaXBfcmF0aW89MS40MCBhcT0xOjEuMDAAgAAAAA5liIQFP///D0UAASq/gAAAAAVBmiAU9QAAAAVBmkAU9QAAAAVBmmAT9QAAAAVBmoAS9Q==', WAKE_WEBM = 'data:video/webm;base64,GkXfo59ChoEBQveBAULygQRC84EIQoKEd2VibUKHgQJChYECGFOAZwEAAAAAAAI/EU2bdLpNu4tTq4QVSalmU6yBoU27i1OrhBZUrmtTrIHYTbuMU6uEElTDZ1OsggEeTbuMU6uEHFO7a1OsggIp7AEAAAAAAABZAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAVSalmsirXsYMPQkBNgI1MYXZmNjAuMTYuMTAwV0GNTGF2ZjYwLjE2LjEwMESJiECPQAAAAAAAFlSua8GuAQAAAAAAADjXgQFzxYjCz9Pua59f/JyBACK1nIN1bmSIgQCGhVZfVlA4g4EBI+ODhAvrwgDgibCBELqBEJqBAhJUw2f8c3OgY8CAZ8iaRaOHRU5DT0RFUkSHjUxhdmY2MC4xNi4xMDBzc9ZjwItjxYjCz9Pua59f/GfIoUWjh0VOQ09ERVJEh5RMYXZjNjAuMzEuMTAyIGxpYnZweGfIoUWjiERVUkFUSU9ORIeTMDA6MDA6MDEuMDAwMDAwMDAwAB9DtnVAhOeBAKOjgQAAgBACAJ0BKhAAEAAARwiFhYiFhIgCAgAMDWAA/v+rUICjlYEAyACxAQABEBAAGAAYWC/0AAgAAKOVgQGQALEBAAEQEAAYABhYL/QACAAAo5WBAlgAsQEAARAQABgAGFgv9AAIAACjlYEDIACxAQABEBAAGAAYWC/0AAgAABxTu2uRu4+zgQC3iveBAfGCAZ/wgQM=';
  function startWakeVideo() {
    try {
      if (!wakeVideo) {
        const v = document.createElement('video');
        v.setAttribute('playsinline', ''); v.setAttribute('muted', ''); v.muted = true; v.loop = true; v.setAttribute('aria-hidden', 'true'); v.tabIndex = -1;
        v.style.cssText = 'position:fixed;width:1px;height:1px;opacity:.01;pointer-events:none;left:0;top:0';
        const w = document.createElement('source'); w.src = WAKE_WEBM; w.type = 'video/webm';
        const m = document.createElement('source'); m.src = WAKE_MP4; m.type = 'video/mp4';
        v.append(w, m); document.body.append(v); wakeVideo = v;
      }
      const p = wakeVideo.play(); if (p && p.catch) p.catch(() => {});
      return true;
    } catch (e) { return false; }
  }
  function stopWakeVideo() { try { if (wakeVideo) wakeVideo.pause(); } catch (e) { /* ignore */ } }
  function warnWake() { if (!wakeWarned) { wakeWarned = true; toast(t('wakeFail')); } }
  async function acquireWake() {
    if (!S.wake || !run.playing) return;
    if (N.isNative && await N.keepAwake(true)) return;
    if (document.hidden) return;
    if (navigator.wakeLock) {
      try {
        if (wakeLock && !wakeLock.released) return;
        wakeLock = await navigator.wakeLock.request('screen');
        if (wakeLock.addEventListener) wakeLock.addEventListener('release', () => { if (run.playing && S.wake && !document.hidden) acquireWake(); });
        return;
      } catch (e) { wakeLock = null; }
    }
    if (!startWakeVideo()) warnWake();
  }
  async function releaseWake() {
    if (N.isNative) N.keepAwake(false);
    stopWakeVideo();
    const w = wakeLock; wakeLock = null;
    try { if (w) await w.release(); } catch (e) { /* ignore */ }
  }

  /* ------------------------------------------------------------------ timer run state */
  const run = { segs: [], tl: null, playing: false, base: 0, p0: 0, w0: 0, idx: 0, tick: 0, lastTickP: 0, lastBeep: '', lastKey: '', lastSave: 0, interrupted: false };

  function buildTimeline() {
    run.segs = E.buildSegments(S.tab, S.cfg, S.sequence);
    run.tl = E.timeline(run.segs);
  }
  const elapsed = () => (run.playing ? run.base + (performance.now() - run.p0) : run.base);
  function resync() { // after the page was hidden: trust whichever clock kept running
    const perfD = performance.now() - run.p0, wallD = Date.now() - run.w0;
    run.base += Math.max(perfD, wallD);
    run.p0 = performance.now(); run.w0 = Date.now();
  }
  const where = () => E.locate(run.tl, elapsed());

  function startTicker() { stopTicker(); run.lastTickP = performance.now(); run.tick = setInterval(tick, 50); }
  function stopTicker() { clearInterval(run.tick); run.tick = 0; }

  function startPause() {
    unlockAudio();
    if (run.playing) { pauseTimer(); return; }
    if (!run.segs.length) { toast(t(S.tab === 'sequence' ? 'tAddStep' : 'tSetTime')); return; }
    if (E.locate(run.tl, run.base).done) { run.base = 0; }
    run.playing = true; run.interrupted = false;
    run.p0 = performance.now(); run.w0 = Date.now();
    run.idx = E.locate(run.tl, run.base).idx; run.lastBeep = ''; run.lastKey = '';
    startTicker(); acquireWake(); announce(t('annStart')); saveSession();
    refreshChrome(); render();
  }
  function pauseTimer(silent) {
    if (!run.playing) return;
    run.base = elapsed(); run.playing = false;
    stopTicker(); releaseWake(); N.cancelAlerts(); saveSession();
    if (!silent) announce(t('annPause'));
    refreshChrome(); render();
  }
  function resetTimer() {
    run.playing = false; run.interrupted = false; stopTicker(); releaseWake(); N.cancelAlerts();
    buildTimeline(); run.base = 0; run.idx = 0; run.lastKey = '';
    clearSession(); refreshChrome(); render(); renderSummary();
  }
  function skip() {
    unlockAudio();
    if (!run.segs.length) return;
    const loc = where();
    if (loc.done) return;
    if (loc.idx >= run.segs.length - 1) { run.base = run.tl.totalMs; if (run.playing) run.p0 = performance.now(); finish(true); return; }
    run.base = run.tl.starts[loc.idx + 1];
    if (run.playing) { run.p0 = performance.now(); run.w0 = Date.now(); run.idx = loc.idx + 1; run.lastBeep = ''; }
    ding(); saveSession(); render();
    announce(`${phaseLabel(run.segs[loc.idx + 1])}. ${roundLabel(run.segs[loc.idx + 1])}`);
  }
  function finish(live) {
    const wasPlaying = run.playing;
    run.playing = false; stopTicker(); releaseWake(); N.cancelAlerts();
    run.base = run.tl.totalMs; run.idx = run.segs.length;
    clearSession(); refreshChrome(); render();
    if (live) { finishChime(); toast(t('tComplete')); } else if (wasPlaying) { toast(t('tFinishedAway')); }
    announce(t('annDone'));
  }

  function tick() {
    if (!run.playing) return;
    const nowP = performance.now();
    const live = nowP - run.lastTickP < 1500; // false right after the page was frozen/hidden: no stale beeps
    run.lastTickP = nowP;
    const loc = where();
    if (loc.done) { finish(live); return; }
    if (loc.idx !== run.idx) {
      run.idx = loc.idx; run.lastBeep = '';
      if (live) ding();
      announce(`${phaseLabel(run.segs[loc.idx])}. ${roundLabel(run.segs[loc.idx])}`);
      saveSession();
    }
    const secs = Math.ceil(loc.remainingMs / 1000);
    if (live && S.warning && E.shouldBeep(S.tab, secs)) {
      const k = run.idx + ':' + secs;
      if (k !== run.lastBeep) { run.lastBeep = k; tone(900, 0.095, 0); }
    }
    if (nowP - run.lastSave > 5000) saveSession();
    render(loc);
  }

  /* ------------------------------------------------------------------ session persistence (survives reloads / OS killing the app) */
  const sig = () => S.tab + ':' + run.segs.length + ':' + run.tl.totalMs;
  function saveSession() {
    run.lastSave = performance.now();
    if (!run.segs.length || (!run.playing && run.base <= 0) || E.locate(run.tl, elapsed()).done) { store.del(SKEY); return; }
    store.set(SKEY, JSON.stringify({ v: 1, sig: sig(), base: elapsed(), playing: run.playing, wall: Date.now() }));
  }
  function clearSession() { store.del(SKEY); }
  function restoreSession() {
    let o = null;
    try { o = JSON.parse(store.get(SKEY) || 'null'); } catch (e) { o = null; }
    if (!o || o.v !== 1 || o.sig !== sig() || !(o.base >= 0) || !(o.wall > 0)) { clearSession(); return; }
    const away = Math.max(0, Date.now() - o.wall);
    if (o.playing && away > 12 * 3600 * 1000) { clearSession(); return; }
    const base = o.base + (o.playing ? away : 0);
    if (base >= run.tl.totalMs) { clearSession(); if (o.playing) toast(t('tFinishedAway')); return; }
    run.base = base; run.idx = E.locate(run.tl, base).idx;
    if (o.playing) {
      run.playing = true; run.p0 = performance.now(); run.w0 = Date.now();
      startTicker(); acquireWake();
    }
  }

  /* ------------------------------------------------------------------ rendering */
  function drawRing(fraction) {
    const ring = $('progressRing'), mask = $('maskRing');
    let dash = `${CIRC}`, off = CIRC * (1 - fraction);
    ring.style.transform = 'rotate(-90deg)';
    if (S.ring === 'arc') { dash = `${CIRC * 0.74} ${CIRC}`; off = CIRC * 0.74 * (1 - fraction); ring.style.transform = 'rotate(137deg)'; }
    if (S.ring === 'dashed') { dash = '8 12'; ring.setAttribute('mask', 'url(#ringMask)'); mask.style.strokeDasharray = `${CIRC}`; mask.style.strokeDashoffset = `${CIRC * (1 - fraction)}`; off = 0; }
    else ring.removeAttribute('mask');
    ring.style.strokeDasharray = dash; ring.style.strokeDashoffset = `${off}`;
  }
  function digitsWidth(txt) {
    let em = 0; for (const ch of txt) em += (ch === ':' ? 0.3 : 0.64) - 0.075;
    return Math.max(2, em);
  }
  function render(locIn) {
    const loc = locIn || where();
    const seg = loc.done ? null : run.segs[loc.idx];
    const finished = run.segs.length > 0 && loc.done;
    const secs = Math.ceil(loc.remainingMs / 1000);
    const fraction = seg ? Math.min(1, Math.max(0, loc.remainingMs / (seg.seconds * 1000))) : (finished ? 0 : 1);
    const key = [secs, loc.idx, Math.round(fraction * 1000), run.playing, finished, S.lang, S.ring].join('|');
    if (key === run.lastKey) return;
    run.lastKey = key;
    const timeText = E.format(secs);
    $('time').textContent = timeText;
    $('time').style.setProperty('--tw', digitsWidth(timeText).toFixed(3));
    const phase = $('phase');
    phase.textContent = finished ? t('phDone') : (run.playing || run.base > 0 ? phaseLabel(seg) : t('ready'));
    phase.classList.toggle('rest', !!seg && (seg.kind === 'rest' || seg.kind === 'break'));
    $('round').textContent = seg ? roundLabel(seg) : '';
    drawRing(fraction);
    $('bar').style.width = `${(1 - fraction) * 100}%`;
    document.title = run.playing || run.base > 0 ? `${timeText} · TimerMask` : t('docTitle');
    const sb = $('startBtn');
    const label = run.playing ? t('pause') : finished ? t('startAgain') : t('start');
    sb.textContent = `${run.playing ? '❚❚' : finished ? '↻' : '▶'} ${label}`;
    sb.setAttribute('aria-label', label);
    $('skipBtn').disabled = finished || !run.segs.length;
    updateNavTime(timeText);
  }
  function renderSummary() {
    const c = S.cfg;
    let s = '';
    if (S.tab === 'tabata') s = t('sumTabata', { work: c.tabata.work, rest: c.tabata.rest, rounds: c.tabata.rounds });
    else if (S.tab === 'focus') s = t('sumFocus', { f: c.focus.focusMin, b: c.focus.breakMin, c: c.focus.cycles });
    else if (S.tab === 'sequence') s = t('sumSeq', { steps: S.sequence.length, time: E.format(run.tl.totalMs / 1000) });
    const total = run.tl && run.tl.totalMs ? t('sumTotal', { time: E.format(run.tl.totalMs / 1000) }) : '';
    if (S.tab !== 'sequence' && total) s = s ? s + ' · ' + total : total;
    $('summary').textContent = s; $('summary2').textContent = s;
    refreshStartLabel();
  }
  function refreshStartLabel() {
    const b = $('startFromTimers'); if (!b) return;
    b.textContent = run.playing ? '⌂ ' + t('backToTimer') : '▶ ' + t('start');
  }
  let navTimeEl = null;
  function updateNavTime(text) {
    const home = document.querySelector('.pageLink[data-page-target="home"]');
    if (!navTimeEl) { navTimeEl = document.createElement('span'); navTimeEl.className = 'navTime'; navTimeEl.setAttribute('aria-hidden', 'true'); home.append(navTimeEl); }
    const show = run.playing && currentPage !== 'home';
    navTimeEl.textContent = show ? ' ' + text : '';
  }

  /* lock editing controls while a timer is running; show/hide the banner */
  function refreshChrome() {
    const lock = run.playing;
    $$('.tab, #presets button, #editBtn').forEach(b => { b.disabled = lock; });
    $$('[data-page="timers"] input:not(.switch), [data-page="timers"] select, [data-page="timers"] .mini, [data-page="timers"] .saveBlock .btn, #addCount, #addInterval').forEach(el => { el.disabled = lock; });
    $('lockedNotice').classList.toggle('hidden', !lock);
    if (!lock) { $('deleteSaved').disabled = !$('savedSelect').value; updateAddButtons(); }
    updateBanner(); refreshStartLabel();
  }
  function updateBanner() {
    if (!N.isNative) return;
    const fs = document.body.classList.contains('fullscreenMode');
    if (!run.playing && !fs && !N.adFree) N.showBanner(); else N.hideBanner();
  }

  /* ------------------------------------------------------------------ theme / prefs */
  function applyTheme() {
    const root = document.documentElement.style;
    const panel = S.light ? '#ffffff' : '#14171d';
    const ui = E.readableAccent(S.color, panel, 3), text = E.readableAccent(S.color, panel, 4.5);
    root.setProperty('--accent', S.color); root.setProperty('--accent-ui', ui); root.setProperty('--accent-text', text);
    root.setProperty('--on-accent', E.onAccent(ui));
    document.body.classList.toggle('light', S.light);
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', S.light ? '#eef0f4' : '#090b0e');
    $$('.swatch[data-color]').forEach(b => { const on = b.dataset.color === S.color; b.classList.toggle('active', on); b.setAttribute('aria-pressed', String(on)); });
    $('customColor').value = S.color;
  }
  function applyRing() {
    $('dial').className = 'dial ' + S.ring;
    $$('.ringChoice').forEach(b => { const on = b.dataset.ring === S.ring; b.classList.toggle('active', on); b.setAttribute('aria-pressed', String(on)); });
    run.lastKey = ''; render();
  }
  function applyPrefs() {
    document.body.classList.toggle('reduceMotion', S.reduceMotion);
    document.body.classList.toggle('largeDigits', S.largeDigits);
    $('light').checked = S.light; $('soundVolume').value = S.volume;
    $('warning').checked = S.warning; $('ding').checked = S.ding; $('wake').checked = S.wake;
    $('reduceMotion').checked = S.reduceMotion; $('largeDigits').checked = S.largeDigits; $('vibration').checked = S.vibration;
    $('interruptionMode').value = S.interrupt;
  }

  /* ------------------------------------------------------------------ i18n */
  function applyI18n() {
    document.documentElement.lang = S.lang;
    $$('[data-i18n]').forEach(n => { n.textContent = t(n.dataset.i18n); });
    $$('[data-i18n-aria]').forEach(n => n.setAttribute('aria-label', t(n.dataset.i18nAria)));
    $$('[data-i18n-title]').forEach(n => { n.title = t(n.dataset.i18nTitle); });
    $('versionLine').textContent = t('version', { v: CFG.version || '' });
    const sel = $('languageSelect');
    if (!sel.options.length) I18N.languages.forEach(([code, name]) => sel.add(new Option(name, code)));
    sel.value = S.lang;
    updateConfigTitle(); renderSequence(); renderPresets(); renderSaved(); renderSummary(); renderMonetization(); updateSaveLabels();
    run.lastKey = ''; render();
  }
  function setLanguage(lang) {
    S.lang = I18N.detect(lang); t = I18N.make(S.lang); persist(); applyI18n();
  }

  /* ------------------------------------------------------------------ modes, fields, presets */
  const FIELD_MAP = {
    minutes: ['countdown', 'minutes'], seconds: ['countdown', 'seconds'],
    work: ['tabata', 'work'], rest: ['tabata', 'rest'], rounds: ['tabata', 'rounds'], prepare: ['tabata', 'prepare'],
    focusMin: ['focus', 'focusMin'], breakMin: ['focus', 'breakMin'], cycles: ['focus', 'cycles']
  };
  function syncInputs() { for (const id of Object.keys(FIELD_MAP)) { const [g, k] = FIELD_MAP[id]; $(id).value = S.cfg[g][k]; } }
  function updateConfigTitle() {
    $('configTitle').textContent = t({ countdown: 'configCountdown', tabata: 'configIntervals', focus: 'configFocus', sequence: 'configSequence' }[S.tab]);
  }
  function setTab(tab, opts) {
    if (!MODES.includes(tab)) return;
    if (run.playing) return;
    const changed = S.tab !== tab;
    S.tab = tab;
    $$('.tab[data-tab]').forEach(b => { const on = b.dataset.tab === tab; b.classList.toggle('active', on); b.setAttribute('aria-pressed', String(on)); });
    $('countdownFields').classList.toggle('hidden', tab !== 'countdown');
    $('intervalFields').classList.toggle('hidden', tab !== 'tabata');
    $('focusFields').classList.toggle('hidden', tab !== 'focus');
    $('sequenceFields').classList.toggle('hidden', tab !== 'sequence');
    updateConfigTitle(); updateSaveLabels(); renderPresets(); renderSaved();
    if (changed || (opts && opts.force)) { persist(); resetTimer(); } else renderSummary();
  }
  function onFieldChange(id) {
    const [g, k] = FIELD_MAP[id];
    S.cfg[g][k] = E.cl(k, $(id).value, S.cfg[g][k]);
    $(id).value = S.cfg[g][k];
    persist(); resetTimer(); renderPresets();
  }

  const fmtShort = (s) => (s < 60 ? `${s}s` : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`);
  const BUILTIN = {
    countdown: [1, 5, 10, 20, 30].map(m => ({ label: () => t('minN', { n: m }), data: { minutes: m, seconds: 0 } })),
    tabata: [[20, 10, 8, 3], [40, 20, 10, 3], [30, 30, 10, 3], [180, 60, 12, 10]].map(([w, r, n, p]) => ({
      label: () => `${fmtShort(w)}/${fmtShort(r)} × ${n}`, data: { work: w, rest: r, rounds: n, prepare: p } })),
    focus: [[25, 5, 4], [50, 10, 3], [90, 15, 2]].map(([f, b, c]) => ({
      label: () => `${t('minN', { n: f + '/' + b })} × ${c}`, data: { focusMin: f, breakMin: b, cycles: c } })),
    sequence: []
  };
  const payloadNow = (mode) => (mode === 'sequence' ? S.sequence : S.cfg[mode]);
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  function applyPayload(mode, data) {
    if (run.playing) return;
    if (mode === 'sequence') S.sequence = E.sanitizeSequence(JSON.parse(JSON.stringify(data)));
    else S.cfg[mode] = E.sanitizeCfg({ [mode]: data })[mode];
    syncInputs(); renderSequence(); persist();
    if (S.tab !== mode) setTab(mode, { force: true }); else resetTimer();
    renderPresets();
  }
  function renderPresets() {
    const host = $('presets');
    host.replaceChildren();
    const mode = S.tab;
    const items = BUILTIN[mode].map(b => ({ text: b.label(), data: b.data }))
      .concat(Object.keys(S.presets[mode]).map(name => ({ text: name, data: S.presets[mode][name], user: true })));
    const current = payloadNow(mode);
    for (const it of items) {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'chip'; b.textContent = it.text;
      const active = same(it.data, current);
      b.classList.toggle('active', active); b.setAttribute('aria-pressed', String(active));
      b.disabled = run.playing;
      b.addEventListener('click', () => applyPayload(mode, it.data));
      host.append(b);
    }
    $('presets').classList.toggle('hidden', items.length === 0);
  }
  function updateSaveLabels() {
    const seq = S.tab === 'sequence';
    $('presetNameLbl').textContent = t(seq ? 'routineName' : 'presetName');
    $('savePresetBtn').textContent = t(seq ? 'saveRoutine' : 'savePreset');
    $('savedLbl').textContent = t(seq ? 'savedRoutines' : 'savedPresets');
  }
  function autoName() {
    const c = S.cfg;
    if (S.tab === 'countdown') return E.format(c.countdown.minutes * 60 + c.countdown.seconds);
    if (S.tab === 'tabata') return `${fmtShort(c.tabata.work)}/${fmtShort(c.tabata.rest)} × ${c.tabata.rounds}`;
    if (S.tab === 'focus') return `${c.focus.focusMin}/${c.focus.breakMin} × ${c.focus.cycles}`;
    return t('tabSequence') + ' ' + E.format(run.tl.totalMs / 1000);
  }
  function renderSaved(selectName) {
    const sel = $('savedSelect');
    sel.replaceChildren(new Option(t('choose'), ''));
    Object.keys(S.presets[S.tab]).forEach(n => sel.add(new Option(n, n)));
    sel.value = selectName && S.presets[S.tab][selectName] ? selectName : '';
    $('deleteSaved').disabled = run.playing || !sel.value;
  }
  function savePreset() {
    if (run.playing) return;
    if (S.tab === 'sequence' && !S.sequence.length) { toast(t('tAddStep')); return; }
    if (S.tab !== 'sequence' && !run.segs.length) { toast(t('tSetTime')); return; }
    const name = E.cleanName($('presetName').value, autoName());
    const map = S.presets[S.tab];
    const keys = Object.keys(map);
    if (!map[name] && keys.length >= E.LIMITS.maxPresets) delete map[keys[0]];
    map[name] = JSON.parse(JSON.stringify(payloadNow(S.tab)));
    persist(); renderSaved(name); renderPresets(); $('presetName').value = ''; toast(t('tSaved'));
  }
  let confirmAction = null;
  function askDelete() {
    const name = $('savedSelect').value;
    if (!name) return;
    $('confirmText').textContent = t('tConfirmDelete', { name });
    confirmAction = () => { delete S.presets[S.tab][name]; persist(); renderSaved(); renderPresets(); toast(t('tDeleted')); };
    openDialog($('confirmDialog'));
  }

  /* ------------------------------------------------------------------ sequence editor */
  function updateAddButtons() {
    const full = S.sequence.length >= E.LIMITS.maxSteps;
    $('addCount').disabled = full || run.playing; $('addInterval').disabled = full || run.playing;
  }
  function renderSequence() {
    const host = $('seqList');
    host.replaceChildren();
    S.sequence.forEach((s, i) => {
      const item = document.createElement('div');
      item.className = 'seqItem';
      const desc = document.createElement('div'); desc.className = 'grow';
      const name = document.createElement('strong'); name.textContent = dn(s.name) || t('defaultStep');
      const details = document.createElement('small');
      details.textContent = s.type === 'countdown' ? E.format(s.seconds) : t('stepInterval', { w: s.work, r: s.rest, n: s.rounds });
      desc.append(name, details); item.append(desc);
      for (const [symbol, action, key] of [['↑', 'up', 'moveUp'], ['↓', 'down', 'moveDown'], ['✎', 'edit', 'edit'], ['×', 'remove', 'remove']]) {
        const b = document.createElement('button');
        b.type = 'button'; b.className = 'mini'; b.textContent = symbol;
        b.title = t(key); b.setAttribute('aria-label', `${t(key)}: ${dn(s.name) || t('defaultStep')}`);
        b.disabled = run.playing || (action === 'up' && i === 0) || (action === 'down' && i === S.sequence.length - 1);
        b.addEventListener('click', () => sequenceAction(i, action));
        item.append(b);
      }
      host.append(item);
    });
    updateAddButtons();
  }
  function sequenceAction(i, action) {
    if (action === 'remove') S.sequence.splice(i, 1);
    else if (action === 'up' || action === 'down') {
      const j = i + (action === 'up' ? -1 : 1);
      [S.sequence[i], S.sequence[j]] = [S.sequence[j], S.sequence[i]];
    } else { openStepDialog(i); return; }
    sequenceChanged();
  }
  function sequenceChanged() { persist(); renderSequence(); resetTimer(); renderPresets(); }
  let editingStep = -1;
  function openStepDialog(i) {
    const s = S.sequence[i]; if (!s) return;
    editingStep = i;
    $('stepName').value = dn(s.name) || '';
    $('stepCountdownFields').classList.toggle('hidden', s.type !== 'countdown');
    $('stepIntervalFields').classList.toggle('hidden', s.type !== 'interval');
    if (s.type === 'countdown') { $('stepMin').value = Math.floor(s.seconds / 60); $('stepSec').value = s.seconds % 60; }
    else { $('stepWork').value = s.work; $('stepRest').value = s.rest; $('stepRounds').value = s.rounds; }
    openDialog($('stepDialog'));
    setTimeout(() => $('stepName').focus(), 30);
  }
  function saveStep() {
    const s = S.sequence[editingStep]; if (!s) return;
    const next = s.type === 'countdown'
      ? { type: 'countdown', name: $('stepName').value, seconds: E.clamp($('stepMin').value, 0, 1440, 0) * 60 + E.clamp($('stepSec').value, 0, 59, 0) }
      : { type: 'interval', name: $('stepName').value, work: $('stepWork').value, rest: $('stepRest').value, rounds: $('stepRounds').value };
    S.sequence[editingStep] = E.sanitizeStep(next) || s;
    closeDialog($('stepDialog')); sequenceChanged();
  }

  /* ------------------------------------------------------------------ routing (Android back button + browser back) */
  let currentPage = 'home', currentSub = null;
  function applyRoute(page, sub, userInitiated) {
    currentPage = PAGES.includes(page) ? page : 'home';
    currentSub = currentPage === 'settings' && SUBS.includes(sub) ? sub : null;
    $$('.page').forEach(x => x.classList.toggle('active', x.dataset.page === currentPage));
    $$('.pageLink').forEach(x => {
      const on = x.dataset.pageTarget === currentPage;
      x.classList.toggle('selected', on);
      if (on) x.setAttribute('aria-current', 'page'); else x.removeAttribute('aria-current');
    });
    $('settingsMenu').classList.toggle('hidden', !!currentSub);
    $$('.settingsDetail').forEach(el => el.classList.toggle('hidden', el.dataset.settingsSection !== currentSub));
    document.body.dataset.current = currentPage;
    $('main').scrollTop = 0;
    if (currentPage !== 'home' && document.body.classList.contains('fullscreenMode')) { if (document.fullscreenElement && document.exitFullscreen) document.exitFullscreen(); setFullUI(false); }
    if (userInitiated) $('main').focus({ preventScroll: true });
    updateNavTime($('time').textContent);
  }
  function go(page, sub) {
    const hash = '#' + page + (sub ? '/' + sub : '');
    if (location.hash !== hash) { try { history.pushState({ page, sub }, '', hash); } catch (e) { /* ignore */ } }
    applyRoute(page, sub, true);
  }
  function routeFromHash() { const [p, s] = location.hash.slice(1).split('/'); applyRoute(PAGES.includes(p) ? p : 'home', s, false); }

  /* ------------------------------------------------------------------ fullscreen */
  let fullFallback = false;
  function setFullUI(on) {
    document.body.classList.toggle('fullscreenMode', on);
    $('exitBtn').classList.toggle('hidden', !on);
    updateBanner();
  }
  function fullscreen() {
    if (currentPage !== 'home') go('home');
    if (document.fullscreenElement) { document.exitFullscreen && document.exitFullscreen(); return; }
    if (document.body.classList.contains('fullscreenMode')) { setFullUI(false); return; }
    if (!fullFallback && document.documentElement.requestFullscreen) {
      document.documentElement.requestFullscreen().catch(() => { fullFallback = true; setFullUI(true); });
    } else setFullUI(true);
  }
  document.addEventListener('fullscreenchange', () => setFullUI(!!document.fullscreenElement));

  /* ------------------------------------------------------------------ background / interruptions */
  function scheduleBackgroundAlerts() {
    if (!N.isNative || !run.playing) return;
    const wall = Date.now();
    const list = E.upcomingBoundaries(run.tl, elapsed(), 60).map(b => {
      const next = run.segs[b.idx + 1];
      return { atMs: wall + b.inMs, title: b.last ? t('annDone') : phaseLabel(next), body: b.last ? t('tComplete') : (roundLabel(next) || 'TimerMask') };
    });
    N.scheduleAlerts(list);
  }
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      if (run.playing) {
        if (S.interrupt === 'pause') { pauseTimer(true); run.interrupted = true; }
        else { saveSession(); scheduleBackgroundAlerts(); }
      }
    } else {
      unlockAudio(); N.cancelAlerts();
      if (run.interrupted) { run.interrupted = false; toast(t('tAway')); }
      else if (run.playing) { resync(); tick(); acquireWake(); }
    }
  });
  window.addEventListener('pagehide', saveSession);
  N.onAppState((active) => { if (!active && run.playing && S.interrupt === 'continue') scheduleBackgroundAlerts(); });

  /* ------------------------------------------------------------------ monetisation UI */
  function renderMonetization() {
    const btn = $('adFreeBtn'), note = $('adFreeNote');
    $('restoreBtn').classList.toggle('hidden', !N.isNative);
    $('adChoicesBtn').classList.toggle('hidden', !N.isNative);
    if (N.isNative && N.adFree) { btn.classList.add('hidden'); note.textContent = t('adsRemoved'); return; }
    btn.classList.remove('hidden');
    btn.textContent = t('removeAds', { price: N.isNative ? N.price : (CFG.priceFallback || '€2.99') });
    note.textContent = N.isNative ? '' : t('adsWebNote');
  }
  async function buy() {
    if (!N.isNative) { toast(t('adsWebNote')); return; }
    const r = await N.purchaseRemoveAds();
    if (r === 'ok') toast(t('adsRemoved')); else if (r === 'pending') toast(t('purchasePending')); else if (r !== 'cancel') toast(t('purchaseFail'));
  }
  async function restore() { toast(t((await N.restorePurchases()) ? 'restoredOk' : 'restoredNone')); }
  N.on('adFree', () => { renderMonetization(); updateBanner(); });
  N.on('price', renderMonetization);
  N.on('adHeight', (h) => document.documentElement.style.setProperty('--ad-h', (h > 0 ? h : 0) + 'px'));

  /* ------------------------------------------------------------------ install (web/PWA only) */
  let installPrompt = null;
  const isInstalled = () => N.isNative || window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  function showInstallHelp(key) { $('installInstructions').textContent = t(key); openDialog($('installHelp')); }
  function refreshInstallButtons() { const hide = isInstalled(); $('installBtn').classList.toggle('hidden', hide); $('settingsInstall').classList.toggle('hidden', hide); }
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installPrompt = e; });
  window.addEventListener('appinstalled', () => { installPrompt = null; refreshInstallButtons(); closeDialog($('installHelp')); toast(t('tInstalled')); });
  async function install() {
    if (isInstalled()) { toast(t('tAlready')); return; }
    if (installPrompt) {
      const p = installPrompt; installPrompt = null;
      try { await p.prompt(); const r = await p.userChoice; if (r.outcome !== 'accepted') toast(t('tAnytime')); } catch (e) { showInstallHelp('instDesktop'); }
      return;
    }
    const ua = navigator.userAgent;
    showInstallHelp(/iPad|iPhone|iPod/.test(ua) ? 'instIos' : /Android/.test(ua) ? 'instAndroid' : 'instDesktop');
  }

  /* ------------------------------------------------------------------ wiring */
  function wire() {
    $$('.tab[data-tab]').forEach(b => b.addEventListener('click', () => setTab(b.dataset.tab)));
    Object.keys(FIELD_MAP).forEach(id => $(id).addEventListener('change', () => onFieldChange(id)));
    $('startBtn').addEventListener('click', startPause);
    $('resetBtn').addEventListener('click', () => { unlockAudio(); resetTimer(); announce(t('annReset')); });
    $('skipBtn').addEventListener('click', skip);
    $('fullBtn').addEventListener('click', fullscreen);
    $('exitBtn').addEventListener('click', fullscreen);
    $('editBtn').addEventListener('click', () => go('timers'));
    $('goTimer').addEventListener('click', () => go('home'));
    $('startFromTimers').addEventListener('click', () => { go('home'); if (!run.playing) startPause(); });
    $$('.pageLink').forEach(b => b.addEventListener('click', () => go(b.dataset.pageTarget)));
    $$('[data-settings-target]').forEach(b => b.addEventListener('click', () => go('settings', b.dataset.settingsTarget)));
    $$('.settingsBack').forEach(b => b.addEventListener('click', () => go('settings')));
    window.addEventListener('popstate', routeFromHash);

    $$('.ringChoice').forEach(b => b.addEventListener('click', () => { S.ring = b.dataset.ring; persist(); applyRing(); }));
    $$('.swatch[data-color]').forEach(b => b.addEventListener('click', () => { S.color = b.dataset.color; persist(); applyTheme(); }));
    $('customColor').addEventListener('input', (e) => { if (validHex(e.target.value)) { S.color = e.target.value.toLowerCase(); applyTheme(); } });
    $('customColor').addEventListener('change', persist);
    $('light').addEventListener('change', (e) => { S.light = e.target.checked; persist(); applyTheme(); });
    $('soundVolume').addEventListener('input', (e) => { S.volume = E.clamp(e.target.value, 0, 100, 65); });
    $('soundVolume').addEventListener('change', () => { persist(); unlockAudio(); tone(900, 0.12, 0); });
    for (const [id, k] of [['warning', 'warning'], ['ding', 'ding']]) $(id).addEventListener('change', (e) => { S[k] = e.target.checked; persist(); });
    $('wake').addEventListener('change', (e) => { S.wake = e.target.checked; persist(); if (run.playing) { if (S.wake) acquireWake(); else releaseWake(); } });
    for (const [id, k] of [['reduceMotion', 'reduceMotion'], ['largeDigits', 'largeDigits'], ['vibration', 'vibration']]) {
      $(id).addEventListener('change', (e) => { S[k] = e.target.checked; persist(); applyPrefs(); if (k === 'vibration' && S.vibration) buzz(60); });
    }
    $('interruptionMode').addEventListener('change', (e) => { S.interrupt = e.target.value; persist(); });
    $('languageSelect').addEventListener('change', (e) => setLanguage(e.target.value));

    $('addCount').addEventListener('click', () => { if (S.sequence.length >= E.LIMITS.maxSteps) return; S.sequence.push({ type: 'countdown', name: t('newCountdown'), seconds: 60 }); sequenceChanged(); });
    $('addInterval').addEventListener('click', () => { if (S.sequence.length >= E.LIMITS.maxSteps) return; S.sequence.push({ type: 'interval', name: t('newIntervals'), work: 40, rest: 20, rounds: 8 }); sequenceChanged(); });
    $('savePresetBtn').addEventListener('click', savePreset);
    $('presetName').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); savePreset(); } });
    $('savedSelect').addEventListener('change', (e) => {
      const name = e.target.value;
      $('deleteSaved').disabled = run.playing || !name;
      if (name && S.presets[S.tab][name]) { applyPayload(S.tab, S.presets[S.tab][name]); $('presetName').value = name; }
    });
    $('deleteSaved').addEventListener('click', askDelete);
    $('confirmYes').addEventListener('click', () => { closeDialog($('confirmDialog')); if (confirmAction) confirmAction(); confirmAction = null; });
    $('confirmNo').addEventListener('click', () => { closeDialog($('confirmDialog')); confirmAction = null; });
    $('stepForm').addEventListener('submit', (e) => { e.preventDefault(); saveStep(); });
    $('stepCancel').addEventListener('click', () => closeDialog($('stepDialog')));

    $('adFreeBtn').addEventListener('click', buy);
    $('restoreBtn').addEventListener('click', restore);
    $('adChoicesBtn').addEventListener('click', () => N.openAdChoices());
    $('installBtn').addEventListener('click', install);
    $('settingsInstall').addEventListener('click', install);
    $('gotInstall').addEventListener('click', () => closeDialog($('installHelp')));
    $('installHelp').addEventListener('click', (e) => { if (e.target === $('installHelp')) closeDialog($('installHelp')); });

    document.addEventListener('keydown', (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const tag = (document.activeElement && document.activeElement.tagName) || '';
      if (/^(INPUT|SELECT|TEXTAREA|BUTTON|A|DIALOG)$/.test(tag) || document.querySelector('dialog[open]')) return;
      if (e.code === 'Space') { e.preventDefault(); startPause(); }
      else if (e.key === 'r' || e.key === 'R') resetTimer();
      else if (e.key === 'f' || e.key === 'F') fullscreen();
    });
    $$('dialog').forEach(d => d.addEventListener('cancel', () => { confirmAction = null; }));
  }

  /* ------------------------------------------------------------------ boot */
  function boot() {
    const coffee = $('coffeeBtn');
    if (/^https:\/\//.test(CFG.coffeeUrl || '') && !N.isNative) { coffee.href = CFG.coffeeUrl; coffee.classList.remove('hidden'); }
    if (N.isNative) $('privacyLink').setAttribute('target', '_self');
    applyTheme(); applyPrefs(); syncInputs();
    buildTimeline();
    setTab(S.tab, { force: false });
    applyRing(); applyI18n();
    restoreSession();
    wire();
    history.replaceState && history.replaceState(null, '', location.hash || '#home');
    routeFromHash();
    refreshInstallButtons(); refreshChrome(); render();
    N.init();
    updateBanner();
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
    if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol) && !N.isNative) {
      window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
    }
    if (window.__TM_TEST__) window.__timermask = { S, run, E, startPause, resetTimer, skip, setTab, go, persist }; // only exposed to automated tests
  }
  boot();
})();
