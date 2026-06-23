// Unit tests for engine.js
// Run: node --test engine.test.js   (Node 18+)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { msDone, pvDone, ownerFromQueue, workersOnDay, simulate, deriveDay } from './engine.js';

// ─── fixtures ─────────────────────────────────────────────────────────────────

function tbl(id, zone, ph, x = 0, y = 0, realMs = null, realPv = null) {
  return { id, zone, x, y, ph, realMs, realPv };
}

// Build minimal simulate() params for a given table array; caller may override any key.
function params(tables, overrides = {}) {
  const zones = [...new Set(tables.map(t => t.zone))].sort();
  const zoneThresholds = Object.fromEntries(zones.map(z => [z, 100]));
  return {
    tables,
    zones,
    zonePriority:       [...zones],
    zoneThresholds,
    activeSubs:         [],
    workforceOverrides: {},
    startDate:          '2025-01-01',
    maxDays:            30,
    ...overrides,
  };
}

// ─── msDone / pvDone ──────────────────────────────────────────────────────────

test('msDone is false below ph 3, true at ph 3+ (ph 3 = MS pending inspection)', () => {
  assert.equal(msDone(tbl('t', 1, 2)), false);
  assert.equal(msDone(tbl('t', 1, 3)), true);
  assert.equal(msDone(tbl('t', 1, 4)), true);
  assert.equal(msDone(tbl('t', 1, 6)), true);
});

test('pvDone is false below ph 5, true at ph 5+', () => {
  assert.equal(pvDone(tbl('t', 1, 4)), false);
  assert.equal(pvDone(tbl('t', 1, 5)), true);
  assert.equal(pvDone(tbl('t', 1, 6)), true);
});

// ─── ownerFromQueue ───────────────────────────────────────────────────────────

test('ownerFromQueue returns correct sub for fractional index', () => {
  const q = [{ sub: 'A', count: 3 }, { sub: 'B', count: 2 }];
  assert.equal(ownerFromQueue(q, 0),   'A');
  assert.equal(ownerFromQueue(q, 2.9), 'A');
  assert.equal(ownerFromQueue(q, 3),   'B');
  assert.equal(ownerFromQueue(q, 4.9), 'B');
});

test('ownerFromQueue clamps to last sub when index exceeds total', () => {
  const q = [{ sub: 'A', count: 2 }];
  assert.equal(ownerFromQueue(q, 99), 'A');
});

test('ownerFromQueue returns null for empty queue', () => {
  assert.equal(ownerFromQueue([], 0), null);
});

// ─── workersOnDay ─────────────────────────────────────────────────────────────

test('workersOnDay returns base workers when no override exists', () => {
  assert.equal(workersOnDay('S1', 10, 1, {}, '2025-01-01'), 10);
});

test('workersOnDay returns override value for the matching day', () => {
  // UTC: 2025-01-01 + 1 day = 2025-01-02
  assert.equal(workersOnDay('S1', 10, 1, { 'S1|2025-01-02': 5 }, '2025-01-01'), 5);
});

test('workersOnDay override on a different sub does not affect this sub', () => {
  assert.equal(workersOnDay('S1', 10, 1, { 'S2|2025-01-02': 5 }, '2025-01-01'), 10);
});

test('workersOnDay override of 0 is respected (not treated as missing)', () => {
  assert.equal(workersOnDay('S1', 10, 1, { 'S1|2025-01-02': 0 }, '2025-01-01'), 0);
});

// ─── simulate: basic completion ───────────────────────────────────────────────

test('simulate: zone with all tables already PV-done completes on day 1', () => {
  const tables = [tbl('T1', 1, 5), tbl('T2', 1, 6)];
  const { zoneCompletionDay, zoneSatisfiedDay } = simulate(params(tables, {
    activeSubs: [{ name: 'S1', workers: 10, prodMs: 1, prodPv: 1, pvOnly: false }],
  }));
  assert.equal(zoneCompletionDay[1], 1);
  assert.equal(zoneSatisfiedDay[1],  1);
});

test('simulate: full-pipeline sub finishes 3-table zone in two days (inspection gap)', () => {
  // 3 tables need MS+PV. Sub has workers=10 (capacity >> 3).
  // Day 1: 3 MS done → pvPending=3 (inspection gap; PV not eligible yet).
  // Day 2: pvPending promoted to pvB; all 3 PV done. Zone complete on day 2.
  const tables = [tbl('A', 1, 0), tbl('B', 1, 0), tbl('C', 1, 0)];
  const { zoneCompletionDay, snapshots } = simulate(params(tables, {
    activeSubs: [{ name: 'S1', workers: 10, prodMs: 1, prodPv: 1, pvOnly: false }],
  }));
  assert.equal(zoneCompletionDay[1], 2, 'inspection gap means PV on day 2 at earliest');
  assert.equal(snapshots[1].remaining[1].ms,        0, 'all MS done after day 1');
  assert.equal(snapshots[1].remaining[1].pvPending, 3, 'tables in inspection after day 1');
  assert.equal(snapshots[1].remaining[1].pvB,       0, 'pvB zero until inspection clears');
  assert.equal(snapshots[2].remaining[1].pvB,       0, 'all PV done by end of day 2');
});

test('simulate: no active subs → no work done, no zone ever completes', () => {
  const tables = [tbl('T1', 1, 0)];
  const { zoneCompletionDay, snapshots } = simulate(params(tables, { maxDays: 5 }));
  assert.equal(Object.keys(zoneCompletionDay).length, 0);
  for (let i = 1; i <= 5; i++) assert.equal(snapshots[i].remaining[1].ms, 1);
});

// ─── simulate: pool A / pool B handling ──────────────────────────────────────

test('simulate: full-pipeline sub drains pool A with leftover capacity when no pvOnly subs', () => {
  // 2 tables at ph=4 are pool A; full-pipeline sub has no MS or pvB work.
  // With new design: leftover capacity after pvB is applied to pvA.
  const tables = [tbl('A', 1, 4), tbl('B', 1, 4)];
  const { zoneCompletionDay, snapshots } = simulate(params(tables, {
    maxDays: 5,
    activeSubs: [{ name: 'S1', workers: 10, prodMs: 1, prodPv: 1, pvOnly: false }],
  }));
  assert.equal(zoneCompletionDay[1], 1, 'zone completes day 1 — full sub consumes pvA');
  assert.equal(snapshots[1].remaining[1].pvA, 0);
});

test('simulate: full-pipeline sub drains pool A with leftover; pvPending holds newly MS-done tables', () => {
  // Zone: 2 tables ph=4 (pool A), 2 tables ph=0 (pool B via simulation)
  // Day 1: pvOnly sub (PVo) processes first → consumes pvA=2. Full: pvAvail=0 → all workers
  //        to MS → B1,B2 MS'd (pvPending=2). PVo gets nothing from pvB (pvB=0).
  // Day 2: pvPending promoted to pvB=2; PVo drains pvB. Zone done day 2.
  const tables = [tbl('A1', 1, 4), tbl('A2', 1, 4), tbl('B1', 1, 0), tbl('B2', 1, 0)];
  const { zoneCompletionDay, snapshots } = simulate(params(tables, {
    activeSubs: [
      { name: 'Full', workers: 10, prodMs: 1, prodPv: 1, pvOnly: false },
      { name: 'PVo',  workers: 10, prodMs: 0, prodPv: 1, pvOnly: true  },
    ],
  }));
  assert.equal(zoneCompletionDay[1], 2, 'inspection gap: pvB tables done on day 2');
  const s1 = snapshots[1];
  assert.equal(s1.msQueue[1][0].sub, 'Full');
  assert.equal(s1.remaining[1].pvA,       0, 'pvA consumed day 1 by pvOnly sub');
  assert.equal(s1.remaining[1].pvPending, 2, 'newly MS-done tables in inspection');
  assert.equal(snapshots[2].remaining[1].pvB, 0, 'all done by day 2');
});

test('simulate: pvOnly sub drains pool A day 1; Full sub drains pool B day 2 (inspection gap)', () => {
  // Day 1: Full (w=1) does MS on PB → pvPending=1. PVo (w=2) drains pvA=1.
  // Day 2: pvPending→pvB=1. Full (or PVo) drains pvB. Zone done day 2.
  const tables = [tbl('PA', 1, 4), tbl('PB', 1, 0)];
  const { zoneCompletionDay, snapshots } = simulate(params(tables, {
    activeSubs: [
      { name: 'Full', workers: 1, prodMs: 1, prodPv: 1, pvOnly: false },
      { name: 'PVo',  workers: 2, prodMs: 0, prodPv: 1, pvOnly: true  },
    ],
  }));
  assert.equal(zoneCompletionDay[1], 2, 'inspection gap: pvB not available until day 2');
  const s1 = snapshots[1];
  assert.equal(s1.pvQueueA[1][0].sub,   'PVo', 'pvA consumed by pvOnly sub');
  assert.equal(s1.pvQueueA[1][0].count, 1);
  assert.equal(s1.remaining[1].pvA,       0);
  assert.equal(s1.remaining[1].pvPending, 1, 'PB in inspection after day 1 MS');
  assert.equal(snapshots[2].remaining[1].pvB, 0, 'pvB drained on day 2');
});

// ─── simulate: VRE threshold ──────────────────────────────────────────────────

test('simulate: VRE threshold <100% causes sub to switch zones before A is fully done', () => {
  // Zone A: 20 tables ph=0. Threshold=50% (needs 10 PV done).
  // Zone B: 5 tables ph=0.  Threshold=100%.
  // Sub: workers=10, prodMs=1, prodPv=1 (parallel crews model).
  //
  // Day 1: pvAvail_A=0 → all 10 workers do MS. A.ms=10, A.pvPending=10.
  // Day 2: pvPending→pvB=10. pvWorkersNeeded=10 → all 10 do PV. A.pvB=0, ms=0.
  //        pvDone=10/20=50% ≥ threshold → zoneSatisfiedDay[A]=2.
  // Day 3: A satisfied → sub moves to B. pvAvail_B=0 → 10 workers do MS. B.ms=0, B.pvPending=5.
  // Day 4: B.pvPending→pvB=5. pvWorkersNeeded=5 → 5 do PV. B.pvB=0. B done.
  //        allTargetsMet (A sat+clear, B sat+clear) → sim breaks on day 4.
  //        zoneCompletionDay[B]=4. A.ms=10 still remaining → zoneCompletionDay[A] not set.
  const tablesA = Array.from({ length: 20 }, (_, i) => tbl(`A${i}`, 'A', 0, i, 0));
  const tablesB = Array.from({ length: 5  }, (_, i) => tbl(`B${i}`, 'B', 0, i, 0));
  const { zoneSatisfiedDay, zoneCompletionDay } = simulate({
    tables:             [...tablesA, ...tablesB],
    zones:              ['A', 'B'],
    zonePriority:       ['A', 'B'],
    zoneThresholds:     { A: 50, B: 100 },
    activeSubs:         [{ name: 'S1', workers: 10, prodMs: 1, prodPv: 1, pvOnly: false }],
    workforceOverrides: {},
    startDate:          '2025-01-01',
    maxDays:            30,
  });
  assert.equal(zoneSatisfiedDay['A'],  2, 'A threshold met on day 2 (parallel PV crew clears pvB)');
  assert.equal(zoneCompletionDay['B'], 4, 'B fully done on day 4');
  assert.equal(zoneCompletionDay['A'], undefined, 'A not fully done — sim stops at VRE targets, not 100%');
});

// ─── simulate: workforce overrides ───────────────────────────────────────────

test('simulate: override to 0 on day 1 means no work is done that day', () => {
  const tables = [tbl('T1', 1, 0)];
  const { snapshots } = simulate(params(tables, {
    workforceOverrides: { 'S1|2025-01-02': 0 }, // day 1 = startDate + 1
    activeSubs: [{ name: 'S1', workers: 10, prodMs: 1, prodPv: 1, pvOnly: false }],
  }));
  assert.equal(snapshots[1].remaining[1].ms, 1, 'ms unchanged when overridden to 0 workers');
});

test('simulate: override to enough workers on day 1 finishes MS; day 2 finishes PV', () => {
  // 20 tables ph=0. Day 1 override = 40 workers: all 20 MS done, pvPending=20.
  // Day 2 (base=1 worker): pvPending→pvB=20; 1 worker does 1 PV/day → takes 20 more days.
  // Verify: MS all done after day 1, zone not complete until pvB drained.
  const tables = Array.from({ length: 3 }, (_, i) => tbl(`T${i}`, 1, 0, i, 0));
  const { zoneCompletionDay, snapshots } = simulate(params(tables, {
    workforceOverrides: { 'S1|2025-01-02': 10 }, // day 1 override: 10 workers, 1/table → all 3 MS + 7 leftover
    activeSubs: [{ name: 'S1', workers: 10, prodMs: 1, prodPv: 1, pvOnly: false }],
  }));
  assert.equal(snapshots[1].remaining[1].ms,        0, 'all MS done on day 1');
  assert.equal(snapshots[1].remaining[1].pvPending, 3, 'tables in inspection after day 1');
  assert.equal(zoneCompletionDay[1], 2, 'PV done on day 2 after inspection clears');
});

// ─── deriveDay ────────────────────────────────────────────────────────────────

test('deriveDay day 0: real phases preserved, real owners assigned', () => {
  const tables = [
    tbl('T0', 1, 0),
    tbl('T2', 1, 2),
    tbl('T4', 1, 4, 0, 0, 'MS1', null),
    tbl('T5', 1, 5, 0, 0, 'MS1', 'PV1'),
    tbl('T6', 1, 6, 0, 0, 'MS1', 'PV1'),
  ];
  const tablesByZone = { 1: tables };
  const { snapshots } = simulate(params(tables));
  const { phase, owner } = deriveDay(snapshots[0], tablesByZone, [1]);

  assert.equal(phase['T0'], 0);
  assert.equal(phase['T2'], 2);
  assert.equal(phase['T4'], 4);
  assert.equal(phase['T5'], 5);
  assert.equal(phase['T6'], 6);
  assert.equal(owner['T4'], 'MS1');
  assert.equal(owner['T5'], 'PV1');
  assert.equal(owner['T6'], 'PV1');
  assert.equal(owner['T0'], null);
});

test('deriveDay: tables MS-done mid-simulation show phase 4', () => {
  // Sub does exactly 1 MS table per day (workers=1, prodMs=1, prodPv=0).
  // Tables at distinct (y,x) so spatial sort is deterministic.
  const tables = [tbl('T1', 1, 0, 0, 0), tbl('T2', 1, 0, 1, 0)];
  const tablesByZone = { 1: tables };
  const { snapshots } = simulate(params(tables, {
    activeSubs: [{ name: 'S1', workers: 1, prodMs: 1, prodPv: 0, pvOnly: false }],
  }));
  // After day 1: ms went 2→1; one table MS-done, one still waiting.
  const { phase } = deriveDay(snapshots[1], tablesByZone, [1]);
  const phases = tables.map(t => phase[t.id]);
  assert.ok(phases.includes(4), 'one table promoted to phase 4');
  assert.ok(phases.includes(0), 'one table still at phase 0');
});

test('deriveDay: spatial order determines which table gets promoted first', () => {
  // Three tables at ph=0 with distinct (y,x). Spatial order: y0x0 < y0x1 < y1x0.
  // Sub does 1 MS per day → only spatially-first table should be promoted on day 1.
  const tables = [
    tbl('y1x0', 1, 0, 0, 1),
    tbl('y0x1', 1, 0, 1, 0),
    tbl('y0x0', 1, 0, 0, 0),
  ];
  const tablesByZone = { 1: tables };
  const { snapshots } = simulate(params(tables, {
    activeSubs: [{ name: 'S1', workers: 1, prodMs: 1, prodPv: 0, pvOnly: false }],
  }));
  const { phase } = deriveDay(snapshots[1], tablesByZone, [1]);
  assert.equal(phase['y0x0'], 4, 'spatially first table should be promoted');
  assert.equal(phase['y0x1'], 0);
  assert.equal(phase['y1x0'], 0);
});

test('deriveDay: tables already ph>=5 in real data are never downgraded by simulation', () => {
  // Mix: one table at ph=5 (already done), one at ph=0 (sim must not touch ph=5).
  const tables = [tbl('Done', 1, 5, 0, 0, 'MS1', 'PV1'), tbl('New', 1, 0, 1, 0)];
  const tablesByZone = { 1: tables };
  const { snapshots } = simulate(params(tables, {
    activeSubs: [{ name: 'S1', workers: 10, prodMs: 1, prodPv: 1, pvOnly: false }],
  }));
  // Check every day snapshot
  for (const snap of snapshots) {
    const { phase } = deriveDay(snap, tablesByZone, [1]);
    assert.equal(phase['Done'], 5, `ph=5 table must remain 5 on day ${snap.day}`);
  }
});

test('deriveDay: sub ownership assigned to MS queue entries via ownerFromQueue', () => {
  const tables = [tbl('T1', 1, 0, 0, 0), tbl('T2', 1, 0, 1, 0)];
  const tablesByZone = { 1: tables };
  // Sub does 1 MS per day with no PV
  const { snapshots } = simulate(params(tables, {
    activeSubs: [{ name: 'Crew', workers: 1, prodMs: 1, prodPv: 0, pvOnly: false }],
  }));
  const { owner } = deriveDay(snapshots[1], tablesByZone, [1]);
  // Spatially first table (T1 at y=0,x=0) was MS'd → owned by 'Crew'
  assert.equal(owner['T1'], 'Crew');
  // T2 not yet MS'd → null
  assert.equal(owner['T2'], null);
});

// ─── regression: reordered zonePriority must not cause 800-day infinite run ──

test('simulate: reversed zonePriority converges when zones have pvA at VRE satisfaction', () => {
  // Zone A: 10 tables, 8 already MS-done (pvA), threshold 80% → satisfied immediately but pvA remains
  // Zone B: 5 tables, all MS-done (pvA), threshold 100%
  // Priority order reversed: B first, A second
  // Bug: once A is VRE-satisfied with pvA remaining, chase mode never drains it → 800 days
  const tables = [
    ...Array.from({ length: 2 }, (_, i) => tbl(`A${i}`, 'A', 1)),   // ph=1, need MS
    ...Array.from({ length: 8 }, (_, i) => tbl(`Ap${i}`, 'A', 4)), // ph=4 = pvA
    ...Array.from({ length: 5 }, (_, i) => tbl(`B${i}`, 'B', 4)),  // ph=4 = pvA
  ];
  const p = params(tables, {
    zones: ['A', 'B'],
    zonePriority: ['B', 'A'],  // reversed
    zoneThresholds: { A: 80, B: 100 },
    activeSubs: [{ name: 'Crew', workers: 50, prodMs: 1, prodPv: 1, pvOnly: false }],
    maxDays: 50,
    globalTargetTables: 13, // 100% of all 13 tables
  });
  const { snapshots } = simulate(p);
  // Must converge well before 800 days
  assert.ok(snapshots.length <= 15, `Expected ≤15 days, got ${snapshots.length}`);
});
