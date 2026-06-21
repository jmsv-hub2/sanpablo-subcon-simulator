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

test('msDone is false below ph 4, true at ph 4+', () => {
  assert.equal(msDone(tbl('t', 1, 3)), false);
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

test('simulate: full-pipeline sub finishes 3-table zone in one day when capacity exceeds work', () => {
  // 3 tables need MS+PV. Sub has workers=10 (capacity >> 3).
  // Day 1: 3 MS done (3 worker-days), 7 leftover → 3 pvB consumed. All done.
  const tables = [tbl('A', 1, 0), tbl('B', 1, 0), tbl('C', 1, 0)];
  const { zoneCompletionDay, snapshots } = simulate(params(tables, {
    activeSubs: [{ name: 'S1', workers: 10, prodMs: 1, prodPv: 1, pvOnly: false }],
  }));
  assert.equal(zoneCompletionDay[1], 1);
  assert.equal(snapshots[1].remaining[1].ms,  0);
  assert.equal(snapshots[1].remaining[1].pvB, 0);
});

test('simulate: no active subs → no work done, no zone ever completes', () => {
  const tables = [tbl('T1', 1, 0)];
  const { zoneCompletionDay, snapshots } = simulate(params(tables, { maxDays: 5 }));
  assert.equal(Object.keys(zoneCompletionDay).length, 0);
  for (let i = 1; i <= 5; i++) assert.equal(snapshots[i].remaining[1].ms, 1);
});

// ─── simulate: pool A / pool B isolation ─────────────────────────────────────

test('simulate: full-pipeline sub never drains pool A (pre-existing MS-done tables)', () => {
  // 2 tables at ph=4 are pool A; full-pipeline sub has no MS or pvB work → stays idle.
  const tables = [tbl('A', 1, 4), tbl('B', 1, 4)];
  const { snapshots } = simulate(params(tables, {
    maxDays: 5,
    activeSubs: [{ name: 'S1', workers: 10, prodMs: 1, prodPv: 1, pvOnly: false }],
  }));
  for (let i = 1; i < snapshots.length; i++)
    assert.equal(snapshots[i].remaining[1].pvA, 2, `pvA must stay 2 on day ${i}`);
});

test('simulate: pvOnly sub drains pool A; full-pipeline sub drains pool B; no cross-contamination', () => {
  // Zone: 2 tables ph=4 (pool A), 2 tables ph=0 (pool B via simulation)
  const tables = [tbl('A1', 1, 4), tbl('A2', 1, 4), tbl('B1', 1, 0), tbl('B2', 1, 0)];
  const { zoneCompletionDay, snapshots } = simulate(params(tables, {
    activeSubs: [
      { name: 'Full', workers: 10, prodMs: 1, prodPv: 1, pvOnly: false },
      { name: 'PVo',  workers: 10, prodMs: 0, prodPv: 1, pvOnly: true  },
    ],
  }));
  assert.equal(zoneCompletionDay[1], 1, 'all done in one day');
  const s = snapshots[1];
  // pvQueueA touched only by PVo
  assert.equal(s.pvQueueA[1].length, 1);
  assert.equal(s.pvQueueA[1][0].sub, 'PVo');
  // msQueue touched only by Full
  assert.equal(s.msQueue[1].length, 1);
  assert.equal(s.msQueue[1][0].sub, 'Full');
});

test('simulate: pvOnly sub drains pool A first, then spills into pool B', () => {
  // Full (workers=1) does MS on 1 table but no leftover for PV → pvB=1 left.
  // PVo (workers=2) drains pvA=1 then pvB=1 within the same day.
  const tables = [tbl('PA', 1, 4), tbl('PB', 1, 0)];
  const { zoneCompletionDay, snapshots } = simulate(params(tables, {
    activeSubs: [
      { name: 'Full', workers: 1, prodMs: 1, prodPv: 1, pvOnly: false },
      { name: 'PVo',  workers: 2, prodMs: 0, prodPv: 1, pvOnly: true  },
    ],
  }));
  assert.equal(zoneCompletionDay[1], 1);
  const s = snapshots[1];
  assert.equal(s.pvQueueA[1][0].sub, 'PVo');
  assert.equal(s.pvQueueA[1][0].count, 1);
  // PVo also appeared in pvQueueB (spill after pvA exhausted)
  assert.ok(s.pvQueueB[1].some(e => e.sub === 'PVo' && e.count === 1));
});

// ─── simulate: VRE threshold ──────────────────────────────────────────────────

test('simulate: VRE threshold <100% causes sub to switch zones before A is fully done', () => {
  // Zone A: 20 tables ph=0. Threshold=50%.
  // Zone B: 5 tables ph=0.  Threshold=100%.
  // Sub: workers=10, prodMs=1, prodPv=1.
  //
  // Day 1+2: sub does MS on A (10/day). After day 2: all 20 MS done, pvB=20.
  // Day 3: sub drains 10 pvB on A → 10 done / 20 total = 50%. zoneSatisfiedDay[A]=3.
  // Day 4: sub moves to B (A is satisfied). Finishes B entirely. zoneCompletionDay[B]=4.
  // Day 5: sub mops up A's remaining pvB=10. zoneCompletionDay[A]=5.
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
  assert.equal(zoneSatisfiedDay['A'],   3);
  assert.equal(zoneCompletionDay['B'],  4, 'B finishes while A still has pvB backlog');
  assert.equal(zoneCompletionDay['A'],  5, 'A mop-up done after B');
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

test('simulate: override to enough workers on day 1 finishes everything in that day', () => {
  // 20 tables ph=0; base workers=1 (takes 40 days). Override to 40 on day 1:
  // 20 worker-days → MS all 20 tables (leftover=20 worker-days) → PV all 20 via leftover.
  const tables = Array.from({ length: 20 }, (_, i) => tbl(`T${i}`, 1, 0, i, 0));
  const { zoneCompletionDay } = simulate(params(tables, {
    workforceOverrides: { 'S1|2025-01-02': 40 },
    activeSubs: [{ name: 'S1', workers: 1, prodMs: 1, prodPv: 1, pvOnly: false }],
  }));
  assert.equal(zoneCompletionDay[1], 1);
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
