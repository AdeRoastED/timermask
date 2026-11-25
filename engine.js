/* TimerMask engine: pure logic, no DOM. Works in the browser (window.TMEngine) and in Node (tests). */
(function (root) {
  'use strict';

  const LIMITS = {
    minutes: [0, 999], seconds: [0, 59],
    work: [1, 3600], rest: [0, 3600], rounds: [1, 200], prepare: [0, 60],
    focusMin: [1, 240], breakMin: [1, 120], cycles: [1, 30],
    stepSeconds: [1, 86400], maxSteps: 30, maxPresets: 30, nameLen: 60
  };

  const clamp = (v, min, max, fallback) => {
    if ((v === '' || v === null || v === undefined || (typeof v === 'string' && !v.trim())) && fallback !== undefined) return fallback;
    const n = Math.round(Number(v));
    if (!Number.isFinite(n)) return fallback === undefined ? min : fallback;
    return Math.min(max, Math.max(min, n));
  };
  const cl = (key, v, fb) => clamp(v, LIMITS[key][0], LIMITS[key][1], fb);
  const cleanName = (s, fb) => {
    const t = (typeof s === 'string' ? s : '').replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, LIMITS.nameLen);
    return t || fb;
  };

  const DEFAULT_CFG = () => ({
    countdown: { minutes: 5, seconds: 0 },
    tabata: { work: 20, rest: 10, rounds: 8, prepare: 3 },
    focus: { focusMin: 25, breakMin: 5, cycles: 4 }
  });
  const DEFAULT_SEQUENCE = () => ([
    { type: 'countdown', name: 'Warm-up', seconds: 300 },
    { type: 'interval', name: 'HIIT', work: 40, rest: 20, rounds: 12 },
    { type: 'countdown', name: 'Cooldown', seconds: 300 }
  ]);

  function sanitizeCfg(c) {
    const d = DEFAULT_CFG();
    c = c && typeof c === 'object' ? c : {};
    const a = c.countdown || {}, b = c.tabata || {}, f = c.focus || {};
    return {
      countdown: { minutes: cl('minutes', a.minutes, d.countdown.minutes), seconds: cl('seconds', a.seconds, 0) },
      tabata: {
        work: cl('work', b.work, d.tabata.work), rest: cl('rest', b.rest, d.tabata.rest),
        rounds: cl('rounds', b.rounds, d.tabata.rounds), prepare: cl('prepare', b.prepare, d.tabata.prepare)
      },
      focus: {
        focusMin: cl('focusMin', f.focusMin, d.focus.focusMin), breakMin: cl('breakMin', f.breakMin, d.focus.breakMin),
        cycles: cl('cycles', f.cycles, d.focus.cycles)
      }
    };
  }

  function sanitizeStep(s) {
    if (!s || typeof s !== 'object') return null;
    if (s.type === 'countdown') {
      return { type: 'countdown', name: cleanName(s.name, 'Timer'), seconds: cl('stepSeconds', s.seconds, 60) };
    }
    if (s.type === 'interval') {
      return {
        type: 'interval', name: cleanName(s.name, 'Timer'),
        work: cl('work', s.work, 40), rest: cl('rest', s.rest, 20), rounds: cl('rounds', s.rounds, 8)
      };
    }
    return null;
  }
  function sanitizeSequence(arr, fallback) {
    if (!Array.isArray(arr)) return fallback === undefined ? DEFAULT_SEQUENCE() : fallback;
    const out = arr.map(sanitizeStep).filter(Boolean).slice(0, LIMITS.maxSteps);
    return out;
  }

  /* Saved presets: { name: payload } where payload depends on mode. */
  function sanitizePresetMap(map, mode) {
    const out = {};
    if (!map || typeof map !== 'object' || Array.isArray(map)) return out;
    let n = 0;
    for (const key of Object.keys(map)) {
      if (n >= LIMITS.maxPresets) break;
      if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue;
      const name = cleanName(key, '');
      if (!name) continue;
      const v = map[key];
      let clean = null;
      if (mode === 'sequence') {
        const seq = sanitizeSequence(v, null);
        if (seq && seq.length) clean = seq;
      } else if (mode === 'countdown') {
        clean = sanitizeCfg({ countdown: v }).countdown;
      } else if (mode === 'tabata') {
        clean = sanitizeCfg({ tabata: v }).tabata;
      } else if (mode === 'focus') {
        clean = sanitizeCfg({ focus: v }).focus;
      }
      if (clean) { out[name] = clean; n++; }
    }
    return out;
  }

  const seg = (kind, seconds, extra) => Object.assign({ kind, seconds: Math.max(1, Math.round(seconds)) }, extra || {});

  /* Segment: {kind, seconds, label?, round?:{i,n,type}} ; kinds: countdown|prepare|work|rest|focus|break */
  function buildSegments(tab, cfg, sequence) {
    const out = [];
    if (tab === 'countdown') {
      const total = cfg.countdown.minutes * 60 + cfg.countdown.seconds;
      if (total > 0) out.push(seg('countdown', total));
    } else if (tab === 'tabata') {
      const { work, rest, rounds, prepare } = cfg.tabata;
      if (prepare) out.push(seg('prepare', prepare));
      for (let i = 1; i <= rounds; i++) {
        out.push(seg('work', work, { round: { i, n: rounds, type: 'round' } }));
        if (rest && i < rounds) out.push(seg('rest', rest, { round: { i, n: rounds, type: 'round' } }));
      }
    } else if (tab === 'focus') {
      const { focusMin, breakMin, cycles } = cfg.focus;
      for (let i = 1; i <= cycles; i++) {
        out.push(seg('focus', focusMin * 60, { round: { i, n: cycles, type: 'cycle' } }));
        if (i < cycles) out.push(seg('break', breakMin * 60, { round: { i, n: cycles, type: 'cycle' } }));
      }
    } else if (tab === 'sequence') {
      for (const step of sequence || []) {
        if (step.type === 'countdown') {
          out.push(seg('countdown', step.seconds, { label: step.name }));
        } else {
          for (let i = 1; i <= step.rounds; i++) {
            out.push(seg('work', step.work, { label: step.name, round: { i, n: step.rounds, type: 'round' } }));
            if (step.rest && i < step.rounds) out.push(seg('rest', step.rest, { round: { i, n: step.rounds, type: 'round' } }));
          }
        }
      }
    }
    return out;
  }

  /* Cumulative boundaries so lookups are O(log n) and exact in integer milliseconds. */
  function timeline(segs) {
    const starts = new Array(segs.length);
    let t = 0;
    for (let i = 0; i < segs.length; i++) { starts[i] = t; t += segs[i].seconds * 1000; }
    return { segs, starts, totalMs: t };
  }

  /* Where are we after `elapsedMs` of continuous running? */
  function locate(tl, elapsedMs) {
    const { segs, starts, totalMs } = tl;
    if (!segs.length) return { idx: 0, remainingMs: 0, done: true };
    if (!(elapsedMs >= 0)) elapsedMs = 0;
    if (elapsedMs >= totalMs) return { idx: segs.length, remainingMs: 0, done: true };
    let lo = 0, hi = segs.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid] <= elapsedMs) lo = mid; else hi = mid - 1;
    }
    const remainingMs = starts[lo] + segs[lo].seconds * 1000 - elapsedMs;
    return { idx: lo, remainingMs, done: false };
  }

  /* Future boundaries, for scheduling background alerts. Returns ms offsets from now. */
  function upcomingBoundaries(tl, elapsedMs, limit, includeLast) {
    const res = [];
    const loc = locate(tl, elapsedMs);
    if (loc.done) return res;
    const mk = (i) => ({ idx: i, inMs: tl.starts[i] + tl.segs[i].seconds * 1000 - elapsedMs, last: i === tl.segs.length - 1 });
    for (let i = loc.idx; i < tl.segs.length && res.length < limit; i++) res.push(mk(i));
    // very long sessions: the final "done" alert is always scheduled, even when the middle phases exceed the limit
    if (includeLast && res.length && !res[res.length - 1].last) res.push(mk(tl.segs.length - 1));
    return res;
  }

  function format(totalSeconds) {
    const s = Math.max(0, Math.ceil(totalSeconds));
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
    const p = (n) => String(n).padStart(2, '0');
    return h ? `${h}:${p(m)}:${p(sec)}` : `${p(m)}:${p(sec)}`;
  }

  /* Should a "final seconds" beep sound for `secs` remaining? */
  function shouldBeep(tab, secs) {
    if (secs < 1) return false;
    return tab === 'countdown' ? secs <= 10 : secs <= 3;
  }

  /* WCAG helpers for user-chosen accent colours. */
  function hexToRgb(hex) {
    const m = /^#?([0-9a-f]{6})$/i.exec(String(hex).trim());
    if (!m) return null;
    const n = parseInt(m[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function rgbToHex(rgb) { return '#' + rgb.map(v => Math.round(v).toString(16).padStart(2, '0')).join(''); }
  function luminance(rgb) {
    const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(rgb[0]) + 0.7152 * f(rgb[1]) + 0.0722 * f(rgb[2]);
  }
  function contrast(a, b) {
    const la = luminance(a), lb = luminance(b);
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
  }
  /* Move the colour towards black or white until it reaches `min` contrast on `bg`. */
  function readableAccent(hex, bgHex, min) {
    const c = hexToRgb(hex), bg = hexToRgb(bgHex);
    if (!c || !bg) return '#ff8a21';
    if (contrast(c, bg) >= min) return rgbToHex(c);
    const target = luminance(bg) > 0.5 ? [0, 0, 0] : [255, 255, 255];
    for (let t = 0.05; t <= 1.0001; t += 0.05) {
      const mix = c.map((v, i) => v + (target[i] - v) * t);
      if (contrast(mix, bg) >= min) return rgbToHex(mix);
    }
    return rgbToHex(target);
  }
  function onAccent(hex) {
    const c = hexToRgb(hex) || [255, 138, 33];
    return contrast(c, [11, 12, 14]) >= contrast(c, [255, 255, 255]) ? '#0b0c0e' : '#ffffff';
  }

  const api = {
    LIMITS, DEFAULT_CFG, DEFAULT_SEQUENCE, clamp, cl, cleanName,
    sanitizeCfg, sanitizeStep, sanitizeSequence, sanitizePresetMap,
    buildSegments, timeline, locate, upcomingBoundaries, format, shouldBeep,
    hexToRgb, rgbToHex, luminance, contrast, readableAccent, onAccent
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.TMEngine = api;
})(typeof self !== 'undefined' ? self : this);
