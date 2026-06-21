// Pure simulation engine — no DOM, no globals.
// All inputs passed explicitly as parameters.
//
// Key design change vs the HTML: simulate() receives activeSubs with prodMs/prodPv
// already resolved by the caller (common-rate vs per-sub is a UI concern, not engine).
// Date arithmetic uses UTC methods so workforceOverrides keys are timezone-safe.

export function msDone(t) { return t.ph >= 4; }
export function pvDone(t) { return t.ph >= 5; }

function spatialSort(a, b) { return (a.y - b.y) || (a.x - b.x); }

// Returns the sub that "owns" the table at fractional queue position indexFloat.
// The queue is an ordered list of {sub, count} chunks accumulated during simulation.
export function ownerFromQueue(queue, indexFloat) {
  let acc = 0;
  for (const entry of queue) {
    if (indexFloat < acc + entry.count) return entry.sub;
    acc += entry.count;
  }
  return queue.length ? queue[queue.length - 1].sub : null;
}

// Returns effective workers for a sub on a given simulation day, consulting the
// override map before falling back to the base value. Uses UTC dates so keys are
// timezone-independent (format: "subName|YYYY-MM-DD").
export function workersOnDay(subName, baseWorkers, dayIdx, workforceOverrides, startDate) {
  const d = new Date(startDate);
  d.setUTCDate(d.getUTCDate() + dayIdx);
  const iso = d.toISOString().slice(0, 10);
  const key = `${subName}|${iso}`;
  return workforceOverrides[key] !== undefined ? workforceOverrides[key] : baseWorkers;
}

/**
 * Run the day-by-day simulation.
 *
 * Two PV backlogs per zone (see README):
 *   pvA — tables that already had MS done in real data (ph===4); only pvOnly subs work here.
 *   pvB — tables that go through MS during the simulation; same full-pipeline crew does MS→PV.
 *
 * @param {object}   p
 * @param {object[]} p.tables            [{id, zone, x, y, ph, realMs, realPv}]
 * @param {any[]}    p.zones             all zone ids in the dataset
 * @param {any[]}    p.zonePriority      attack order (subset/reorder of zones)
 * @param {object}   p.zoneThresholds    {zone: minPct}; key absent → defaults to 100
 * @param {object[]} p.activeSubs        [{name, workers, prodMs, prodPv, pvOnly}]
 *                                       prodMs/prodPv already resolved by caller
 * @param {object}   p.workforceOverrides {"subName|YYYY-MM-DD": workers}
 * @param {string}   p.startDate         ISO date string for simulation day 0
 * @param {number}   p.maxDays           upper bound on simulation length
 * @returns {{snapshots, zoneCompletionDay, zoneSatisfiedDay}}
 */
export function simulate({
  tables, zones, zonePriority, zoneThresholds,
  activeSubs, workforceOverrides = {}, startDate, maxDays,
}) {
  const totalByZone = {};
  zones.forEach(z => { totalByZone[z] = tables.filter(t => t.zone === z).length; });

  const remaining = {};
  zones.forEach(z => {
    const ts = tables.filter(t => t.zone === z);
    remaining[z] = {
      ms:  ts.filter(t => !msDone(t)).length,
      pvA: ts.filter(t => t.ph === 4).length,
      pvB: 0,
    };
  });

  const clone = o => JSON.parse(JSON.stringify(o));
  const msQueue = {}, pvQueueA = {}, pvQueueB = {};
  zones.forEach(z => { msQueue[z] = []; pvQueueA[z] = []; pvQueueB[z] = []; });

  const snapshots = [{
    day: 0,
    remaining: clone(remaining),
    assignment: {},
    msQueue:   clone(msQueue),
    pvQueueA:  clone(pvQueueA),
    pvQueueB:  clone(pvQueueB),
  }];

  const zoneCompletionDay = {};
  const zoneSatisfiedDay  = {};

  const totalRemaining = z => { const r = remaining[z]; return r.ms + r.pvA + r.pvB; };
  const pvDonePct = z => {
    const done = totalByZone[z] - totalRemaining(z);
    return totalByZone[z] > 0 ? (done / totalByZone[z]) * 100 : 100;
  };
  const zoneSatisfied  = z => totalRemaining(z) <= 0 || pvDonePct(z) >= (zoneThresholds[z] ?? 100);
  const hasWorkForSub  = (z, isPvOnly) => {
    const r = remaining[z];
    return isPvOnly ? (r.pvA + r.pvB) > 0 : (r.ms + r.pvB) > 0;
  };

  for (let day = 1; day <= maxDays; day++) {
    const assignment = {};
    zones.forEach(z => { assignment[z] = []; });

    const subTargets = [];
    activeSubs.forEach(s => {
      const workers = workersOnDay(s.name, s.workers, day, workforceOverrides, startDate);
      if (workers <= 0) return;
      let target = zonePriority.find(z => !zoneSatisfied(z) && hasWorkForSub(z, s.pvOnly));
      if (target === undefined) target = zonePriority.find(z => hasWorkForSub(z, s.pvOnly));
      if (target === undefined) return;
      subTargets.push({ name: s.name, zone: target, workers, prodMs: s.prodMs, prodPv: s.prodPv, pvOnly: s.pvOnly });
      assignment[target].push(s.name);
    });

    subTargets.forEach(st => {
      const r = remaining[st.zone];
      if (st.pvOnly) {
        let capacity = st.workers * st.prodPv;
        const consumedA = Math.min(r.pvA, capacity);
        if (consumedA > 0) {
          r.pvA -= consumedA;
          capacity -= consumedA;
          pvQueueA[st.zone].push({ sub: st.name, count: consumedA });
        }
        const consumedB = Math.min(r.pvB, capacity);
        if (consumedB > 0) {
          r.pvB -= consumedB;
          pvQueueB[st.zone].push({ sub: st.name, count: consumedB });
        }
      } else {
        const msWorkerDaysNeeded = st.prodMs > 0 ? r.ms / st.prodMs : Infinity;
        let consumedMs, leftoverWorkerDays;
        if (msWorkerDaysNeeded <= st.workers) {
          consumedMs = r.ms;
          leftoverWorkerDays = st.workers - msWorkerDaysNeeded;
        } else {
          consumedMs = st.workers * st.prodMs;
          leftoverWorkerDays = 0;
        }
        if (consumedMs > 0) {
          r.ms  -= consumedMs;
          r.pvB += consumedMs; // MS-done tables immediately eligible for same crew's PV
          msQueue[st.zone].push({ sub: st.name, count: consumedMs });
        }
        if (leftoverWorkerDays > 0) {
          const consumedPv = Math.min(r.pvB, leftoverWorkerDays * st.prodPv);
          if (consumedPv > 0) {
            r.pvB -= consumedPv;
            pvQueueB[st.zone].push({ sub: st.name, count: consumedPv });
          }
        }
      }
    });

    zones.forEach(z => {
      if (zoneCompletionDay[z] === undefined && totalRemaining(z) < 0.01) zoneCompletionDay[z] = day;
      if (zoneSatisfiedDay[z]  === undefined && zoneSatisfied(z))          zoneSatisfiedDay[z]  = day;
    });

    snapshots.push({
      day,
      remaining: clone(remaining),
      assignment,
      msQueue:  clone(msQueue),
      pvQueueA: clone(pvQueueA),
      pvQueueB: clone(pvQueueB),
    });

    if (Object.keys(zoneCompletionDay).length === zones.length) break;
  }

  return { snapshots, zoneCompletionDay, zoneSatisfiedDay };
}

/**
 * Reconstruct per-table phase and owner sub from a single day's snapshot.
 * Tables are walked in spatial order (y, x) so sub ownership blocks are geographically
 * contiguous rather than scattered by alphabetical id order.
 *
 * @param {object}   snapshot      one entry from simulate().snapshots
 * @param {object}   tablesByZone  {zone: table[]}  (pre-grouped, stable reference)
 * @param {any[]}    zones
 * @returns {{phase: object, owner: object}}
 */
export function deriveDay(snapshot, tablesByZone, zones) {
  const phase = {}, owner = {};

  zones.forEach(z => {
    const ts = tablesByZone[z];
    const r  = snapshot.remaining[z];

    // MS step: ph 0/1/2/3 → 4 (green)
    const msPool     = ts.filter(t => !msDone(t)).sort(spatialSort);
    const msDoneCum  = msPool.length - r.ms;
    msPool.forEach((t, i) => {
      if (i < msDoneCum) { phase[t.id] = 4; owner[t.id] = ownerFromQueue(snapshot.msQueue[z], i); }
      else               { phase[t.id] = t.ph; }
    });
    ts.forEach(t => { if (msDone(t)) phase[t.id] = 4; }); // real-data MS-done tables start green

    // PV step: green (4) → dark blue (5), pool A and B consumed independently
    const groupA = ts.filter(t => t.ph === 4).sort(spatialSort);          // pre-existing backlog
    const groupB = msPool.filter(t => phase[t.id] === 4).sort(spatialSort); // freshly MS'd in sim
    const doneA  = groupA.length - r.pvA;
    const doneB  = groupB.length - r.pvB;

    groupA.forEach((t, i) => {
      if (i < doneA) { phase[t.id] = 5; owner[t.id] = ownerFromQueue(snapshot.pvQueueA[z], i) || owner[t.id]; }
      else           { phase[t.id] = 4; }
    });
    groupB.forEach((t, i) => {
      if (i < doneB) { phase[t.id] = 5; owner[t.id] = ownerFromQueue(snapshot.pvQueueB[z], i) || owner[t.id]; }
      else           { phase[t.id] = 4; }
    });

    // Real-data ph>=5 tables are never touched by the simulation
    ts.forEach(t => { if (t.ph >= 5) phase[t.id] = t.ph; });

    // Fall back to real-data ownership for tables the sim didn't assign
    ts.forEach(t => {
      if (owner[t.id] === undefined || owner[t.id] === null)
        owner[t.id] = t.ph >= 5 ? t.realPv : (msDone(t) ? t.realMs : null);
    });
  });

  return { phase, owner };
}
