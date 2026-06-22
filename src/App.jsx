import { useState, useMemo, useCallback, useEffect } from 'react'
import { ZONES, TABLES, TABLES_BY_ZONE, TOTAL_TABLES, TOTAL_MWP, MWP_PER_TABLE, TOTAL_BY_ZONE } from './data.js'
import { simulate, deriveDay } from '../engine.js'
import LeftPanel from './components/LeftPanel.jsx'
import MapCanvas from './components/MapCanvas.jsx'
import Legend from './components/Legend.jsx'
import BottomStats from './components/BottomStats.jsx'

const TODAY = new Date().toISOString().slice(0, 10)
function defaultDeadline() {
  const d = new Date(); d.setDate(d.getDate() + 180); return d.toISOString().slice(0, 10)
}
export function fmtDate(startDate, dayOffset) {
  const d = new Date(startDate)
  d.setDate(d.getDate() + dayOffset)
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}

export default function App() {
  // ── General manpower inputs ──
  const [generalWorkers,    setGeneralWorkers]    = useState(200)
  const [generalRateMs,     setGeneralRateMs]     = useState(0.5)
  const [generalRatePv,     setGeneralRatePv]     = useState(0.4)
  const [sundayWorkersPct,  setSundayWorkersPct]  = useState(100)

  // ── Zones ──
  const [zonePriority,   setZonePriority]   = useState([...ZONES])
  const [zoneThresholds, setZoneThresholds] = useState(() => {
    const VRE = { 1: 73, 2: 90, 3: 90, 4: 85, 5: 55, 6: 72, 7: 80, 8: 82, 9: 80 }
    return Object.fromEntries(ZONES.map(z => [z, VRE[z] ?? 100]))
  })

  // ── Deadline / target ──
  const [globalDeadline, setGlobalDeadline] = useState(defaultDeadline)  // eslint-disable-line no-unused-vars
  const [targetPct,      setTargetPct]      = useState(80)

  // ── Calendar overrides ──
  const [generalCalOverrides, setGeneralCalOverrides] = useState({})

  // ── Layer toggles ──
  const [layerPhase,  setLayerPhase]  = useState(true)
  const [layerLabels, setLayerLabels] = useState(true)

  // ── Simulation result ──
  const [sim,    setSim]    = useState(null)
  const [dayIdx, setDayIdx] = useState(0)

  // ── Single crew — all workers in one group ──
  const activeSubs = useMemo(() => [{
    name: 'Crew', workers: generalWorkers,
    prodMs: generalRateMs, prodPv: generalRatePv, pvOnly: false,
  }], [generalWorkers, generalRateMs, generalRatePv])

  // ── Workforce overrides for the engine ──
  const workforceOverrides = useMemo(() => {
    const result = {}
    if (sundayWorkersPct < 100) {
      const end = new Date(globalDeadline)
      const d = new Date(TODAY)
      while (d <= end) {
        if (d.getDay() === 0) {
          const dateStr = d.toISOString().slice(0, 10)
          result[`Crew|${dateStr}`] = Math.floor(generalWorkers * sundayWorkersPct / 100)
        }
        d.setDate(d.getDate() + 1)
      }
    }
    Object.entries(generalCalOverrides).forEach(([date, w]) => {
      result[`Crew|${date}`] = w
    })
    return result
  }, [generalWorkers, sundayWorkersPct, globalDeadline, generalCalOverrides])

  // ── Initial render: show real data state ──
  useEffect(() => {
    const result = simulate({
      tables: TABLES, zones: ZONES,
      zonePriority: [...ZONES],
      zoneThresholds: Object.fromEntries(ZONES.map(z => [z, 100])),
      activeSubs: [], workforceOverrides: {}, startDate: TODAY, maxDays: 0,
    })
    setSim(result)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const runSim = useCallback(() => {
    const globalTargetTables = Math.ceil(TOTAL_TABLES * Math.max(1, Math.min(100, targetPct)) / 100)
    const result = simulate({ tables: TABLES, zones: ZONES, zonePriority, zoneThresholds, activeSubs, workforceOverrides, startDate: TODAY, maxDays: 800, globalTargetTables })
    setSim(result)
    setDayIdx(0)
  }, [zonePriority, zoneThresholds, activeSubs, workforceOverrides])

  // ── Derived visual state ──
  const derived = useMemo(() => {
    if (!sim) return null
    return deriveDay(sim.snapshots[dayIdx], TABLES_BY_ZONE, ZONES)
  }, [sim, dayIdx])

  const snap = sim?.snapshots[dayIdx] ?? null

  // ── Stats ──
  const stats = useMemo(() => {
    if (!sim || !derived || !snap) return null

    // Work still needed globally to reach targetPct% of the total park
    const tPct         = Math.max(1, Math.min(100, targetPct))
    const targetTables = Math.ceil(TOTAL_TABLES * tPct / 100)

    let pvDoneGlobal = 0, pvAGlobal = 0
    ZONES.forEach(z => {
      const r = snap.remaining[z]
      const total_z = TABLES_BY_ZONE[z].length
      pvDoneGlobal += total_z - r.ms - r.pvA - r.pvB - (r.pvPending || 0)
      pvAGlobal    += r.pvA
    })
    const pvGap   = Math.max(0, targetTables - pvDoneGlobal)
    const totalPv = pvGap
    const totalMs = Math.max(0, pvGap - pvAGlobal)

    const pvDoneCount   = TABLES.filter(t => derived.phase[t.id] >= 5).length
    const completedMwp  = pvDoneCount * MWP_PER_TABLE
    let targetDay = null
    for (const s of sim.snapshots) {
      let done = 0
      ZONES.forEach(z => { done += TABLES_BY_ZONE[z].length - s.remaining[z].ms - s.remaining[z].pvA - s.remaining[z].pvB - (s.remaining[z].pvPending || 0) })
      if (done >= targetTables) { targetDay = s.day; break }
    }
    const targetDate   = targetDay !== null ? (() => { const d = new Date(TODAY); d.setDate(d.getDate() + targetDay); return d })() : null
    const targetStatus = targetDate ? (targetDate <= new Date(globalDeadline) ? 'ok' : 'bad') : 'unknown'

    return { totalMs, totalPv, pvDoneCount, completedMwp, targetDay, targetStatus, tPct, targetTables }
  }, [sim, derived, snap, globalDeadline, targetPct, zoneThresholds])

  // ── Daily throughput ──
  const dailyThroughput = useMemo(() => {
    if (!sim || dayIdx === 0) return { ms: 0, pv: 0, total: 0 }
    const prev = sim.snapshots[dayIdx - 1]
    const curr = sim.snapshots[dayIdx]
    let ms = 0, pv = 0
    ZONES.forEach(z => {
      ms += prev.remaining[z].ms - curr.remaining[z].ms
      pv += (prev.remaining[z].pvA - curr.remaining[z].pvA)
           + (prev.remaining[z].pvB - curr.remaining[z].pvB)
           + (prev.remaining[z].pvPending || 0)
    })
    return { ms: Math.max(0, ms), pv: Math.max(0, pv), total: Math.max(0, ms + pv) }
  }, [sim, dayIdx])

  const fmt = (offset) => offset !== null && offset !== undefined ? fmtDate(TODAY, offset) : '—'

  return (
    <>
      <LeftPanel
        generalWorkers={generalWorkers} setGeneralWorkers={setGeneralWorkers}
        generalRateMs={generalRateMs}   setGeneralRateMs={setGeneralRateMs}
        generalRatePv={generalRatePv}   setGeneralRatePv={setGeneralRatePv}
        sundayWorkersPct={sundayWorkersPct} setSundayWorkersPct={setSundayWorkersPct}
        snap={snap} stats={stats} fmt={fmt}
        zonePriority={zonePriority} setZonePriority={setZonePriority}
        zoneThresholds={zoneThresholds} setZoneThresholds={setZoneThresholds}
        globalDeadline={globalDeadline}
        targetPct={targetPct} setTargetPct={setTargetPct}
        generalCalOverrides={generalCalOverrides} setGeneralCalOverrides={setGeneralCalOverrides}
        onRun={runSim} simReady={!!sim && sim.snapshots.length > 1}
        simDays={sim ? sim.snapshots.length - 1 : 0}
        today={TODAY}
      />

      <div className="main-col">
        <div className="topbar">
          <div>
            <div className="daylabel">Day {dayIdx}</div>
            <div className="datelabel">{fmtDate(TODAY, dayIdx)}</div>
          </div>
          <input id="slider" type="range" min={0} max={sim ? sim.snapshots.length - 1 : 0} value={dayIdx}
            onChange={e => setDayIdx(+e.target.value)} disabled={!sim || sim.snapshots.length <= 1} style={{ flex: 1 }} />
          <div style={{ display: 'flex', gap: 4 }}>
            <button className="daystep" onClick={() => setDayIdx(i => Math.max(0, i - 1))}>◀</button>
            <button className="daystep" onClick={() => setDayIdx(i => Math.min((sim?.snapshots.length ?? 1) - 1, i + 1))}>▶</button>
          </div>
        </div>

        <div className="map-area">
          <MapCanvas
            derived={derived}
            layerPhase={layerPhase}   setLayerPhase={setLayerPhase}
            layerLabels={layerLabels} setLayerLabels={setLayerLabels}
            zoneSatisfiedDay={sim?.zoneSatisfiedDay} dayIdx={dayIdx}
          />
          <Legend />
        </div>

        <BottomStats
          sim={sim} stats={stats} snap={snap} fmt={fmt}
          zonePriority={zonePriority} zoneThresholds={zoneThresholds}
          dayIdx={dayIdx} dailyThroughput={dailyThroughput}
        />
      </div>
    </>
  )
}
