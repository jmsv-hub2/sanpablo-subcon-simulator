// Pure simulation engine — no DOM, no globals.
// All inputs passed explicitly as parameters.
//
// Key design change vs the HTML: simulate() receives activeSubs with prodMs/prodPv
// already resolved by the caller (common-rate vs per-sub is a UI concern, not engine).
// Date arithmetic uses UTC methods so workforceOverrides keys are timezone-safe.

export function msDone(t) { return t.ph >= 3; }
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
 * Three PV pools per zone:
 *   pvA       — tables MS-done in real data (ph===4). Consumed by pvOnly subs first; if none,
 *               non-pvOnly subs consume pvA with their PV crew.
 *   pvB       — tables MS-done during simulation, inspection cleared. PV-eligible.
 *   pvPending — tables MS-done today; moved to pvB next day (1-day inspection gap).
 *
 * Worker model (parallel crews): on any given day each worker does EITHER MS OR PV, not both.
 * pvOnly subs are processed first so they consume pvA/pvB before non-pvOnly subs allocate workers.
 * Non-pvOnly subs: pvWorkers = min(workers, pvAvail/pvRate) → rest go to MS.
 * No MS is started on a zone once its VRE threshold is satisfied.
 * Simulation stops when all zones are VRE-satisfied AND pvPending=pvB≈0 everywhere.
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
  globalTargetTables = 0,
}) {
  const totalByZone = {};
  zones.forEach(z => { totalByZone[z] = tables.filter(t => t.zone === z).length; });

  const remaining = {};
  zones.forEach(z => {
    const ts = tables.filter(t => t.zone === z);
    remaining[z] = {
      ms:        ts.filter(t => !msDone(t)).length,
      pvA:       ts.filter(t => t.ph >= 3 && t.ph < 5).length,
      pvB:       0,
      pvPending: 0, // MS-done tables under inspection; eligible for PV from next day onwards
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

  const totalRemaining = z => { const r = remaining[z]; return r.ms + r.pvA + r.pvB + r.pvPending; };
  const pvDonePct = z => {
    const done = totalByZone[z] - totalRemaining(z);
    return totalByZone[z] > 0 ? (done / totalByZone[z]) * 100 : 100;
  };
  const zoneSatisfied = z => totalRemaining(z) <= 0 || pvDonePct(z) >= (zoneThresholds[z] ?? 100);

  // Once a zone is VRE-satisfied, no further work is assigned there (MS or PV),
  // unless we're in global-target chase mode (all VRE met, global target not yet reached).
  const hasWorkForSub = (z, isPvOnly, chase = false) => {
    if (zoneSatisfied(z) && !chase) return false;
    const r = remaining[z];
    if (isPvOnly) return (r.pvA + r.pvB) > 0;
    return (r.pvA + r.pvB + r.ms) > 0;
  };

  for (let day = 1; day <= maxDays; day++) {
    // Promote yesterday's inspected MS → eligible for PV today (1-day inspection gap)
    zones.forEach(z => { remaining[z].pvB += remaining[z].pvPending; remaining[z].pvPending = 0; });

    // Global-target chase: all VRE thresholds met but target % not yet reached → keep working.
    const pvDoneNow = zones.reduce((s, z) => {
      const r = remaining[z]; return s + totalByZone[z] - r.ms - r.pvA - r.pvB - (r.pvPending || 0);
    }, 0);
    const areAllVreMet   = zones.every(z => zoneSatisfied(z));
    const isGlobalMet    = globalTargetTables <= 0 || pvDoneNow >= globalTargetTables;
    const inGlobalChase  = areAllVreMet && !isGlobalMet;

    const assignment = {};
    zones.forEach(z => { assignment[z] = []; });

    const subTargets = [];
    activeSubs.forEach(s => {
      const workers = workersOnDay(s.name, s.workers, day, workforceOverrides, startDate);
      if (workers <= 0) return;
      let target;
      if (inGlobalChase) {
        // Chase mode: continue from the LAST zone in priority with remaining work
        // (avoids jumping back to zone 1 when the last active zone still has tables)
        const available = zonePriority.filter(z => hasWorkForSub(z, s.pvOnly, true));
        target = available[available.length - 1];
      } else {
        target = zonePriority.find(z => !zoneSatisfied(z) && hasWorkForSub(z, s.pvOnly, false));
        if (target === undefined) target = zonePriority.find(z => hasWorkForSub(z, s.pvOnly, false));
      }
      if (target === undefined) return;

      // Satisfied zones are fully abandoned — no pvB cleanup there.
      const pvCleanupZone = undefined;

      subTargets.push({ name: s.name, zone: target, pvCleanupZone, workers, prodMs: s.prodMs, prodPv: s.prodPv, pvOnly: s.pvOnly });
      assignment[target].push(s.name);
    });

    // pvOnly subs processed first so they consume pvA/pvB before non-pvOnly subs allocate
    const pvOnlyTargets = subTargets.filter(st => st.pvOnly);
    const fullTargets   = subTargets.filter(st => !st.pvOnly);

    pvOnlyTargets.forEach(st => {
      const r = remaining[st.zone];
      let capacity = st.workers * st.prodPv;
      const consumedB = Math.min(r.pvB, capacity);
      if (consumedB > 0) { r.pvB -= consumedB; capacity -= consumedB; pvQueueB[st.zone].push({ sub: st.name, count: consumedB }); }
      const consumedA = Math.min(r.pvA, capacity);
      if (consumedA > 0) { r.pvA -= consumedA; pvQueueA[st.zone].push({ sub: st.name, count: consumedA }); }
    });

    // Returns how many MS tables must still be done in zone z to eventually reach its VRE threshold.
    // Derivation: eventual_pvDone = (total - ms - pvA - pvB - pvPending) + pvA + pvB + pvPending + ms_to_do
    //                             = total - ms + ms_to_do   (pvA, pvB, pvPending cancel out)
    // Therefore: ms_needed = max(0, minPvDone - total + ms_remaining)
    // Note: pvA is intentionally excluded — it will be PV'd regardless and is already counted.
    const msNeededForZone = z => {
      const rz = remaining[z];
      const minPvDone = Math.ceil(totalByZone[z] * (zoneThresholds[z] ?? 100) / 100);
      return Math.max(0, minPvDone - totalByZone[z] + rz.ms);
    };

    fullTargets.forEach(st => {
      let budget = st.workers;

      // Step 1: pvB cleanup in a satisfied zone that was abandoned (parallel crews).
      if (st.pvCleanupZone !== undefined) {
        const rc = remaining[st.pvCleanupZone];
        if (rc.pvB > 0 && st.prodPv > 0) {
          const cleanupWorkersNeeded = rc.pvB / st.prodPv;
          const cleanupWorkers = Math.min(budget, cleanupWorkersNeeded);
          const consumed = Math.min(rc.pvB, cleanupWorkers * st.prodPv);
          if (consumed > 0) {
            rc.pvB -= consumed;
            pvQueueB[st.pvCleanupZone].push({ sub: st.name, count: consumed });
            budget -= cleanupWorkers;
          }
        }
      }

      if (budget <= 0) return;
      const r = remaining[st.zone];

      // Step 2: PV work on primary zone.
      const pvAvail = r.pvA + r.pvB;
      const pvWorkersNeeded = st.prodPv > 0 && pvAvail > 0 ? pvAvail / st.prodPv : 0;
      const pvWorkerDays = Math.min(budget, pvWorkersNeeded);
      if (pvWorkerDays > 0) {
        let pvCap = pvWorkerDays * st.prodPv;
        const consumedB = Math.min(r.pvB, pvCap);
        if (consumedB > 0) { r.pvB -= consumedB; pvCap -= consumedB; pvQueueB[st.zone].push({ sub: st.name, count: consumedB }); }
        const consumedA = Math.min(r.pvA, pvCap);
        if (consumedA > 0) { r.pvA -= consumedA; pvQueueA[st.zone].push({ sub: st.name, count: consumedA }); }
      }

      // Re-evaluate chase after PV work: zone may have crossed its VRE threshold mid-day.
      // Without this, workers go idle on the transition day even though the global target
      // is still not reached.
      const pvDonePostPV = zones.reduce((s, z) => {
        const rz = remaining[z]; return s + totalByZone[z] - rz.ms - rz.pvA - rz.pvB - (rz.pvPending || 0);
      }, 0);
      const effectiveChase = inGlobalChase ||
        (zones.every(z => zoneSatisfied(z)) && globalTargetTables > 0 && pvDonePostPV < globalTargetTables);

      // Step 3: MS on primary zone — capped to VRE threshold unless in chase.
      let msWorkersUsed = 0;
      if (!zoneSatisfied(st.zone) || effectiveChase) {
        const msWorkerDays = budget - pvWorkerDays;
        const needed = effectiveChase ? r.ms : msNeededForZone(st.zone);
        if (msWorkerDays > 0.01 && r.ms > 0 && needed > 0) {
          const consumedMs = Math.min(r.ms, Math.min(needed, msWorkerDays * st.prodMs));
          if (consumedMs > 0) {
            r.ms        -= consumedMs;
            r.pvPending += consumedMs;
            msQueue[st.zone].push({ sub: st.name, count: consumedMs });
            msWorkersUsed = st.prodMs > 0 ? consumedMs / st.prodMs : 0;
          }
        }
      }

      // Step 4: Sweep remaining idle capacity.
      let idle = budget - pvWorkerDays - msWorkersUsed;
      const sweepOrder = effectiveChase
        ? [...zonePriority].reverse().filter(z => z !== st.zone)
        : zonePriority.filter(z => z !== st.zone);
      for (const z of sweepOrder) {
        if (idle <= 0.01) break;
        const rz = remaining[z];

        // PV in this zone
        const pvAvailZ = rz.pvA + rz.pvB;
        if (pvAvailZ > 0 && st.prodPv > 0) {
          const pvWorkersZ = Math.min(idle, pvAvailZ / st.prodPv);
          if (pvWorkersZ > 0.01) {
            let pvCapZ = pvWorkersZ * st.prodPv;
            const consumedBZ = Math.min(rz.pvB, pvCapZ);
            if (consumedBZ > 0) { rz.pvB -= consumedBZ; pvCapZ -= consumedBZ; pvQueueB[z].push({ sub: st.name, count: consumedBZ }); }
            const consumedAZ = Math.min(rz.pvA, pvCapZ);
            if (consumedAZ > 0) { rz.pvA -= consumedAZ; pvQueueA[z].push({ sub: st.name, count: consumedAZ }); }
            idle -= pvWorkersZ;
            if (!assignment[z].includes(st.name)) assignment[z].push(st.name);
          }
        }

        // MS in this zone (capped to VRE-needed, or uncapped in chase)
        if (idle > 0.01 && (!zoneSatisfied(z) || effectiveChase) && rz.ms > 0 && st.prodMs > 0) {
          const neededZ = effectiveChase ? rz.ms : msNeededForZone(z);
          if (neededZ > 0) {
            const consumedMsZ = Math.min(rz.ms, Math.min(neededZ, idle * st.prodMs));
            if (consumedMsZ > 0.01) {
              rz.ms -= consumedMsZ; rz.pvPending += consumedMsZ;
              msQueue[z].push({ sub: st.name, count: consumedMsZ });
              idle -= consumedMsZ / st.prodMs;
              if (!assignment[z].includes(st.name)) assignment[z].push(st.name);
            }
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

    // Stop when all VRE targets met AND global target reached (or no global target set).
    const pvDoneAfter = zones.reduce((s, z) => {
      const r = remaining[z]; return s + totalByZone[z] - r.ms - r.pvA - r.pvB - (r.pvPending || 0);
    }, 0);
    if (zones.every(z => zoneSatisfied(z)) && (globalTargetTables <= 0 || pvDoneAfter >= globalTargetTables)) break;
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
    const groupA = ts.filter(t => t.ph >= 3 && t.ph < 5).sort(spatialSort); // pre-existing backlog (ph 3=MS pending, 4=MS approved)
    const groupB = msPool.filter(t => phase[t.id] === 4).sort(spatialSort); // freshly MS'd in sim
    const doneA  = groupA.length - r.pvA;
    const doneB  = groupB.length - r.pvB - (r.pvPending || 0); // pvPending = inspected, not yet PV-eligible

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
