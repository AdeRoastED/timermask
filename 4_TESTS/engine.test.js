const test = require('node:test');
const assert = require('node:assert/strict');
const E = require('../web/engine.js');

const cfg = (o) => E.sanitizeCfg(o);

test('countdown builds a single segment; zero total builds none', () => {
  assert.equal(E.buildSegments('countdown', cfg({ countdown: { minutes: 5, seconds: 30 } })).length, 1);
  assert.equal(E.buildSegments('countdown', cfg({ countdown: { minutes: 5, seconds: 30 } }))[0].seconds, 330);
  assert.equal(E.buildSegments('countdown', cfg({ countdown: { minutes: 0, seconds: 0 } })).length, 0);
});

test('tabata: prepare + work/rest, no rest after last round, total time correct', () => {
  const segs = E.buildSegments('tabata', cfg({ tabata: { work: 20, rest: 10, rounds: 8, prepare: 3 } }));
  assert.equal(segs.length, 1 + 8 + 7);
  assert.equal(segs[0].kind, 'prepare');
  assert.equal(segs[segs.length - 1].kind, 'work');
  const tl = E.timeline(segs);
  assert.equal(tl.totalMs, (3 + 8 * 20 + 7 * 10) * 1000);
});

test('tabata with rest=0 and prepare=0 has only work segments', () => {
  const segs = E.buildSegments('tabata', cfg({ tabata: { work: 5, rest: 0, rounds: 3, prepare: 0 } }));
  assert.deepEqual(segs.map(s => s.kind), ['work', 'work', 'work']);
});

test('focus: cycles with breaks between, none after last', () => {
  const segs = E.buildSegments('focus', cfg({ focus: { focusMin: 25, breakMin: 5, cycles: 4 } }));
  assert.deepEqual(segs.map(s => s.kind), ['focus', 'break', 'focus', 'break', 'focus', 'break', 'focus']);
  assert.equal(E.timeline(segs).totalMs, (4 * 25 + 3 * 5) * 60000);
});

test('sequence expands intervals and keeps labels', () => {
  const seq = E.sanitizeSequence(E.DEFAULT_SEQUENCE());
  const segs = E.buildSegments('sequence', cfg(), seq);
  assert.equal(segs.length, 1 + (12 + 11) + 1);
  assert.equal(segs[0].label, 'Warm-up');
  assert.equal(segs[1].label, 'HIIT');
});

test('locate: exact boundaries, last millisecond, done', () => {
  const tl = E.timeline(E.buildSegments('tabata', cfg({ tabata: { work: 20, rest: 10, rounds: 2, prepare: 0 } })));
  assert.deepEqual(E.locate(tl, 0), { idx: 0, remainingMs: 20000, done: false });
  assert.equal(E.locate(tl, 19999).idx, 0);
  assert.equal(E.locate(tl, 20000).idx, 1);
  assert.equal(E.locate(tl, 30000).idx, 2);
  assert.equal(E.locate(tl, 49999).idx, 2);
  assert.equal(E.locate(tl, 50000).done, true);
  assert.equal(E.locate(tl, 1e12).done, true);
  assert.equal(E.locate(tl, -5).idx, 0);
  assert.equal(E.locate(tl, NaN).idx, 0);
});

test('no cumulative drift: 200 rounds of 1s work + 1s rest lands exactly on schedule', () => {
  // Regression for v2.5: every phase restarted from "now", losing up to a tick per phase.
  const tl = E.timeline(E.buildSegments('tabata', cfg({ tabata: { work: 1, rest: 1, rounds: 200, prepare: 0 } })));
  assert.equal(tl.totalMs, (200 + 199) * 1000);
  // Simulate a ticker that fires every 80ms with jitter up to 40ms late; the position must match ideal time.
  let t = 0, maxErr = 0;
  while (t < tl.totalMs) {
    t += 80 + Math.floor(Math.random() * 40);
    const loc = E.locate(tl, t);
    if (loc.done) break;
    const ideal = E.locate(tl, t);
    maxErr = Math.max(maxErr, Math.abs(ideal.remainingMs - loc.remainingMs));
  }
  assert.equal(maxErr, 0);
  assert.equal(E.locate(tl, 399 * 1000 - 1).idx, 398);
  assert.equal(E.locate(tl, 399 * 1000).done, true);
});

test('catch-up after the screen was locked: jumping 95s ahead lands in the right phase', () => {
  const tl = E.timeline(E.buildSegments('tabata', cfg({ tabata: { work: 20, rest: 10, rounds: 8, prepare: 3 } })));
  const loc = E.locate(tl, 95000);
  // 3 prepare, then cycles of 30s starting at 3: 95-3 = 92 -> round 4 (idx 1+6=7 is round4 work at 93? compute)
  let acc = 0, expect = 0;
  for (let i = 0; i < tl.segs.length; i++) { if (acc + tl.segs[i].seconds * 1000 > 95000) { expect = i; break; } acc += tl.segs[i].seconds * 1000; }
  assert.equal(loc.idx, expect);
  assert.equal(loc.remainingMs, acc + tl.segs[expect].seconds * 1000 - 95000);
});

test('upcomingBoundaries returns correct offsets and flags the last', () => {
  const tl = E.timeline(E.buildSegments('tabata', cfg({ tabata: { work: 20, rest: 10, rounds: 2, prepare: 0 } })));
  const b = E.upcomingBoundaries(tl, 5000, 10);
  assert.deepEqual(b.map(x => x.inMs), [15000, 25000, 45000]);
  assert.equal(b[2].last, true);
  assert.equal(E.upcomingBoundaries(tl, 5000, 2).length, 2);
  assert.equal(E.upcomingBoundaries(tl, 60000, 2).length, 0);
});

test('format', () => {
  assert.equal(E.format(0), '00:00');
  assert.equal(E.format(0.2), '00:01');
  assert.equal(E.format(59.01), '01:00');
  assert.equal(E.format(3600), '1:00:00');
  assert.equal(E.format(5999 * 60 + 59), '99:59'.length ? E.format(5999 * 60 + 59) : '');
  assert.equal(E.format(-4), '00:00');
});

test('beeps: countdown last 10s, others last 3s, never at zero', () => {
  assert.equal(E.shouldBeep('countdown', 10), true);
  assert.equal(E.shouldBeep('countdown', 11), false);
  assert.equal(E.shouldBeep('tabata', 4), false);
  assert.equal(E.shouldBeep('tabata', 3), true);
  assert.equal(E.shouldBeep('focus', 0), false);
});

test('sanitizeCfg clamps hostile or broken values', () => {
  const c = E.sanitizeCfg({ countdown: { minutes: 99999, seconds: -4 }, tabata: { work: 'abc', rest: 1e9, rounds: 0, prepare: NaN }, focus: null });
  assert.equal(c.countdown.minutes, 999);
  assert.equal(c.countdown.seconds, 0);
  assert.equal(c.tabata.work, 20);
  assert.equal(c.tabata.rest, 3600);
  assert.equal(c.tabata.rounds, 1);
  assert.equal(c.tabata.prepare, 3);
  assert.deepEqual(c.focus, { focusMin: 25, breakMin: 5, cycles: 4 });
  assert.deepEqual(E.sanitizeCfg(null), E.sanitizeCfg(undefined));
});

test('sanitizeSequence drops junk, limits size and names, strips markup characters', () => {
  const junk = [null, 5, 'x', { type: 'nope' }, { type: 'countdown', name: '<img src=x onerror=alert(1)>', seconds: 1e12 }];
  const out = E.sanitizeSequence(junk);
  assert.equal(out.length, 1);
  assert.equal(out[0].seconds, 86400);
  assert.ok(!/[<>]/.test(out[0].name));
  const many = Array.from({ length: 500 }, () => ({ type: 'countdown', name: 'a'.repeat(500), seconds: 5 }));
  const lim = E.sanitizeSequence(many);
  assert.equal(lim.length, E.LIMITS.maxSteps);
  assert.ok(lim[0].name.length <= E.LIMITS.nameLen);
  assert.deepEqual(E.sanitizeSequence('not an array', []), []);
});

test('sanitizePresetMap blocks prototype keys, caps count, validates per mode', () => {
  const evil = JSON.parse('{"__proto__":{"polluted":1},"ok":{"work":30,"rest":5,"rounds":3,"prepare":2},"":{"work":1}}');
  const m = E.sanitizePresetMap(evil, 'tabata');
  assert.deepEqual(Object.keys(m), ['ok']);
  assert.equal(({}).polluted, undefined);
  const big = {}; for (let i = 0; i < 100; i++) big['p' + i] = { minutes: 1, seconds: 0 };
  assert.equal(Object.keys(E.sanitizePresetMap(big, 'countdown')).length, E.LIMITS.maxPresets);
  assert.deepEqual(E.sanitizePresetMap([1, 2], 'focus'), {});
  assert.deepEqual(E.sanitizePresetMap({ a: [] }, 'sequence'), {});
});

test('accent colour helpers keep UI readable on both themes', () => {
  const dark = '#14171d', light = '#ffffff';
  assert.ok(E.contrast(E.hexToRgb(E.readableAccent('#ffffff', light, 3)), E.hexToRgb(light)) >= 3);
  assert.ok(E.contrast(E.hexToRgb(E.readableAccent('#000000', dark, 3)), E.hexToRgb(dark)) >= 3);
  assert.equal(E.readableAccent('#ff8a21', dark, 3), '#ff8a21');
  assert.equal(E.readableAccent('garbage', dark, 3), '#ff8a21');
  assert.equal(E.onAccent('#ff8a21'), '#0b0c0e');
  assert.equal(E.onAccent('#000000'), '#ffffff');
});

test('blank or missing input falls back to the previous valid value', () => {
  assert.equal(E.cl('rounds', '', 8), 8);
  assert.equal(E.cl('rounds', '  ', 8), 8);
  assert.equal(E.cl('rounds', undefined, 8), 8);
  assert.equal(E.cl('rounds', '0', 8), 1);
});
