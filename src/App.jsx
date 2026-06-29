import { useState, useMemo, useCallback, useEffect } from 'react'
import { ZONES, TABLES, TOTAL_TABLES, TOTAL_MWP, MWP_PER_TABLE, TOTAL_BY_ZONE } from './data.js'

// Read-only access to the sanpablo-tracker Google Sheet via Apps Script.
// This app NEVER writes to the sheet — only GET ?action=read is used.
const TRACKER_API = 'https://script.google.com/macros/s/AKfycbwJQNUg5oRFeUABFEf_QfPGFa9XJBekbZs2gtreickGGCXxP-74UC_tvtPiX8x60DqGUg/exec'
import { simulate, deriveDay } from '../engine.js'
import LeftPanel from './components/LeftPanel.jsx'
import MapCanvas from './components/MapCanvas.jsx'
import Legend from './components/Legend.jsx'
import BottomStats from './components/BottomStats.jsx'
import PlanTab from './components/PlanTab.jsx'
import SaveLoad from './components/SaveLoad.jsx'

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
  const [generalWorkers,    setGeneralWorkers]    = useState(250)
  const [generalRateMs,     setGeneralRateMs]     = useState(0.5)
  const [generalRatePv,     setGeneralRatePv]     = useState(0.4)
  const [sundayWorkersPct,  setSundayWorkersPct]  = useState(0)

  // ── Worker batches (additive from a start date) ──
  const [workerBatches, setWorkerBatches] = useState([])

  // ── Zones ──
  const [zonePriority,   setZonePriority]   = useState([...ZONES])
  const [zoneThresholds, setZoneThresholds] = useState(() => {
    const VRE = { 1: 73, 2: 90, 3: 90, 4: 85, 5: 55, 6: 72, 7: 80, 8: 82, 9: 80 }
    return Object.fromEntries(ZONES.map(z => [z, VRE[z] ?? 100]))
  })

  // ── Deadline / target ──
  const [globalDeadline, setGlobalDeadline] = useState(defaultDeadline)  // eslint-disable-line no-unused-vars
  const [targetPct,      setTargetPct]      = useState(80)

  // ── Per-day absolute overrides ──
  const [generalCalOverrides, setGeneralCalOverrides] = useState({})

  // ── Non-productive workers ──
  const [nonProdPct, setNonProdPct] = useState(10)
  const [calApplyNonProd, setCalApplyNonProd] = useState(true)

  // ── Layer toggles ──
  const [layerLabels,      setLayerLabels]      = useState(true)
  const [layerTableLabels, setLayerTableLabels] = useState(false)

  // ── Live data from tracker Sheet (read-only) ──
  const [tables,      setTables]      = useState(TABLES)
  const [sheetStatus, setSheetStatus] = useState('loading')
  const [sheetDate,   setSheetDate]   = useState(null)

  const loadSheetData = useCallback(() => {
    setSheetStatus('loading')
    fetch(`${TRACKER_API}?action=read&_=${Date.now()}`, { cache: 'no-store' }) // GET only — never writes to the sheet
      .then(r => r.json())
      .then(data => {
        const rows = Array.isArray(data.data) ? data.data : Object.values(data.data || {})
        const phases = Object.fromEntries(rows.filter(r => r.id != null).map(r => [r.id, r.phase]))
        setTables(TABLES.map(t => ({ ...t, ph: phases[t.id] ?? t.ph })))
        setSheetDate(new Date())
        setSheetStatus('ok')
      })
      .catch(() => setSheetStatus('error'))
  }, [])

  useEffect(() => { loadSheetData() }, [loadSheetData])

  // ── Simulation result ──
  const [sim,    setSim]    = useState(null)
  const [dayIdx, setDayIdx] = useState(0)

  // ── Effective workers (after non-productive deduction) ──
  const effectiveWorkers = useMemo(
    () => Math.round(generalWorkers * (1 - Math.max(0, Math.min(100, nonProdPct)) / 100)),
    [generalWorkers, nonProdPct]
  )

  // ── Single crew ──
  const activeSubs = useMemo(() => [{
    name: 'Crew', workers: effectiveWorkers,
    prodMs: generalRateMs, prodPv: generalRatePv, pvOnly: false,
  }], [effectiveWorkers, generalRateMs, generalRatePv])

  // ── Workforce overrides: Sunday reduction + batches + per-day overrides ──
  const workforceOverrides = useMemo(() => {
    const result = {}
    const hasBatches = workerBatches.length > 0
    const hasSundayReduction = sundayWorkersPct < 100

    if (hasSundayReduction || hasBatches) {
      const end = new Date(globalDeadline)
      for (let d = new Date(TODAY), i = 0; d <= end && i < 800; d.setDate(d.getDate() + 1), i++) {
        const dateStr = d.toISOString().slice(0, 10)
        const isSunday = d.getDay() === 0
        const batchTotal = workerBatches
          .filter(b => b.fromDate <= dateStr)
          .reduce((s, b) => s + b.count, 0)
        const baseTotal = generalWorkers + batchTotal
        let workers = isSunday ? Math.round(baseTotal * sundayWorkersPct / 100) : baseTotal
        const nonProdFactor = calApplyNonProd ? (1 - Math.max(0, Math.min(100, nonProdPct)) / 100) : 1
        workers = Math.round(workers * nonProdFactor)
        if (workers !== effectiveWorkers) result[`Crew|${dateStr}`] = workers
      }
    }
    // Per-day absolute overrides replace everything
    Object.entries(generalCalOverrides).forEach(([date, w]) => {
      result[`Crew|${date}`] = w
    })
    return result
  }, [generalWorkers, effectiveWorkers, sundayWorkersPct, globalDeadline, generalCalOverrides, workerBatches, nonProdPct, calApplyNonProd])

  // ── tablesByZone: recomputed whenever Sheet data refreshes ──
  const tablesByZone = useMemo(
    () => Object.fromEntries(ZONES.map(z => [z, tables.filter(t => t.zone === z)])),
    [tables]
  )

  // ── Show real data state on map — refreshes automatically when Sheet data arrives ──
  useEffect(() => {
    setSim(prev => {
      // Don't discard a full simulation the user already ran
      if (prev && prev.snapshots.length > 1) return prev
      return simulate({
        tables, zones: ZONES,
        zonePriority: [...ZONES],
        zoneThresholds: Object.fromEntries(ZONES.map(z => [z, 100])),
        activeSubs: [], workforceOverrides: {}, startDate: TODAY, maxDays: 0,
      })
    })
  }, [tables]) // eslint-disable-line react-hooks/exhaustive-deps

  const runSim = useCallback(() => {
    const globalTargetTables = Math.ceil(TOTAL_TABLES * Math.max(1, Math.min(100, targetPct)) / 100)
    const result = simulate({ tables, zones: ZONES, zonePriority, zoneThresholds, activeSubs, workforceOverrides, startDate: TODAY, maxDays: 800, globalTargetTables })
    setSim(result)
    setDayIdx(0)
  }, [tables, zonePriority, zoneThresholds, activeSubs, workforceOverrides, targetPct])

  // ── Derived visual state ──
  const derived = useMemo(() => {
    if (!sim) return null
    return deriveDay(sim.snapshots[dayIdx], tablesByZone, ZONES)
  }, [sim, dayIdx, tablesByZone])

  const snap = sim?.snapshots[dayIdx] ?? null

  // ── Stats ──
  const simReady = !!sim && sim.snapshots.length > 1
  const stats = useMemo(() => {
    if (!simReady || !derived || !snap) return null

    // Work still needed globally to reach targetPct% of the total park
    const tPct         = Math.max(1, Math.min(100, targetPct))
    const targetTables = Math.ceil(TOTAL_TABLES * tPct / 100)

    let pvDoneGlobal = 0, pvAGlobal = 0
    ZONES.forEach(z => {
      const r = snap.remaining[z]
      const total_z = tablesByZone[z].length
      pvDoneGlobal += total_z - r.ms - r.pvA - r.pvB - (r.pvPending || 0)
      pvAGlobal    += r.pvA
    })
    const pvGap   = Math.max(0, targetTables - pvDoneGlobal)
    const totalPv = pvGap
    const totalMs = Math.max(0, pvGap - pvAGlobal)

    const pvDoneCount  = tables.filter(t => derived.phase[t.id] >= 5).length
    const completedMwp = pvDoneCount * MWP_PER_TABLE

    // Scan snapshots once for both the intermediate target date and 100% completion date
    let targetDay = null, fullTargetDay = null
    for (const s of sim.snapshots) {
      let done = 0
      ZONES.forEach(z => { done += tablesByZone[z].length - s.remaining[z].ms - s.remaining[z].pvA - s.remaining[z].pvB - (s.remaining[z].pvPending || 0) })
      if (targetDay === null && done >= targetTables) targetDay = s.day
      if (fullTargetDay === null && done >= TOTAL_TABLES) { fullTargetDay = s.day; break }
    }

    const targetDate   = targetDay !== null ? (() => { const d = new Date(TODAY); d.setDate(d.getDate() + targetDay); return d })() : null
    const targetStatus = targetDate ? (targetDate <= new Date(globalDeadline) ? 'ok' : 'bad') : 'unknown'

    return { totalMs, totalPv, pvDoneCount, completedMwp, targetDay, fullTargetDay, targetStatus, tPct, targetTables }
  }, [sim, simReady, derived, snap, globalDeadline, targetPct, zoneThresholds, tablesByZone, tables])

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

  const dailyWorkers = useMemo(() => {
    const d = new Date(TODAY)
    d.setDate(d.getDate() + dayIdx)
    const dateStr = d.toISOString().slice(0, 10)
    return workforceOverrides[`Crew|${dateStr}`] ?? effectiveWorkers
  }, [dayIdx, workforceOverrides, effectiveWorkers])

  const fmt = (offset) => offset !== null && offset !== undefined ? fmtDate(TODAY, offset) : '—'

  // ── Tab state ──
  const [activeTab, setActiveTab] = useState('map') // 'map' | 'plan'

  // ── MSPV plan (per-day table assignments) ──
  const planData = useMemo(() => {
    if (!simReady) return null
    const allDerived = sim.snapshots.map(s => deriveDay(s, tablesByZone, ZONES))
    const startDate = new Date(TODAY)
    return sim.snapshots.slice(1).map((snap, i) => {
      const prev = allDerived[i]
      const curr = allDerived[i + 1]
      const msToday = Object.fromEntries(ZONES.map(z => [z, []]))
      const pvToday = Object.fromEntries(ZONES.map(z => [z, []]))
      ZONES.forEach(z => {
        tablesByZone[z].forEach(t => {
          const pp = prev.phase[t.id], cp = curr.phase[t.id]
          if (pp < 3 && cp >= 3) msToday[z].push(t.id)
          if (pp < 5 && cp >= 5) pvToday[z].push(t.id)
        })
      })
      const msCount = ZONES.reduce((s, z) => s + msToday[z].length, 0)
      const pvCount = ZONES.reduce((s, z) => s + pvToday[z].length, 0)
      const d = new Date(startDate); d.setDate(d.getDate() + snap.day)
      const dateStr = d.toISOString().slice(0, 10)
      const workers = workforceOverrides[`Crew|${dateStr}`] ?? effectiveWorkers
      const msWorkers = generalRateMs > 0 ? Math.round(msCount / generalRateMs) : 0
      const pvWorkers = generalRatePv > 0 ? Math.round(pvCount / generalRatePv) : 0
      return { day: snap.day, dateStr, workers, msCount, pvCount, msWorkers, pvWorkers, msToday, pvToday }
    }).filter(d => d.msCount > 0 || d.pvCount > 0)
  }, [sim, simReady, workforceOverrides, effectiveWorkers, generalRateMs, generalRatePv, tablesByZone])

  // ── Save / Open simulation parameters (input config only — Sheet data stays live) ──
  const getConfig = useCallback(() => ({
    version: 1,
    generalWorkers, generalRateMs, generalRatePv, sundayWorkersPct,
    nonProdPct, calApplyNonProd,
    workerBatches, zonePriority, zoneThresholds, targetPct, generalCalOverrides,
  }), [generalWorkers, generalRateMs, generalRatePv, sundayWorkersPct, nonProdPct,
       calApplyNonProd, workerBatches, zonePriority, zoneThresholds, targetPct, generalCalOverrides])

  const applyConfig = useCallback(cfg => {
    if (!cfg || typeof cfg !== 'object') return
    if (cfg.generalWorkers      != null) setGeneralWorkers(cfg.generalWorkers)
    if (cfg.generalRateMs       != null) setGeneralRateMs(cfg.generalRateMs)
    if (cfg.generalRatePv       != null) setGeneralRatePv(cfg.generalRatePv)
    if (cfg.sundayWorkersPct    != null) setSundayWorkersPct(cfg.sundayWorkersPct)
    if (cfg.nonProdPct          != null) setNonProdPct(cfg.nonProdPct)
    if (cfg.calApplyNonProd     != null) setCalApplyNonProd(cfg.calApplyNonProd)
    if (Array.isArray(cfg.workerBatches)) setWorkerBatches(cfg.workerBatches)
    if (Array.isArray(cfg.zonePriority) && cfg.zonePriority.length === ZONES.length) setZonePriority(cfg.zonePriority)
    if (cfg.zoneThresholds && typeof cfg.zoneThresholds === 'object') setZoneThresholds(cfg.zoneThresholds)
    if (cfg.targetPct           != null) setTargetPct(cfg.targetPct)
    if (cfg.generalCalOverrides && typeof cfg.generalCalOverrides === 'object') setGeneralCalOverrides(cfg.generalCalOverrides)
  }, [])

  return (
    <>
      <LeftPanel
        generalWorkers={generalWorkers} setGeneralWorkers={setGeneralWorkers}
        generalRateMs={generalRateMs}   setGeneralRateMs={setGeneralRateMs}
        generalRatePv={generalRatePv}   setGeneralRatePv={setGeneralRatePv}
        sundayWorkersPct={sundayWorkersPct} setSundayWorkersPct={setSundayWorkersPct}
        workerBatches={workerBatches} setWorkerBatches={setWorkerBatches}
        snap={snap} stats={stats} fmt={fmt}
        zonePriority={zonePriority} setZonePriority={setZonePriority}
        zoneThresholds={zoneThresholds} setZoneThresholds={setZoneThresholds}
        globalDeadline={globalDeadline}
        targetPct={targetPct} setTargetPct={setTargetPct}
        generalCalOverrides={generalCalOverrides} setGeneralCalOverrides={setGeneralCalOverrides}
        onRun={runSim} simReady={simReady}
        simDays={sim ? sim.snapshots.length - 1 : 0}
        today={TODAY}
        sheetStatus={sheetStatus} sheetDate={sheetDate} onRefreshSheet={loadSheetData}
        nonProdPct={nonProdPct} setNonProdPct={setNonProdPct}
        calApplyNonProd={calApplyNonProd} setCalApplyNonProd={setCalApplyNonProd}
        effectiveWorkers={effectiveWorkers}
        getConfig={getConfig} applyConfig={applyConfig}
      />

      <div className="main-col">
        <div className="topbar">
          {/* Tab switcher */}
          <div className="tab-switcher">
            <button className={`tab-btn${activeTab === 'map' ? ' active' : ''}`} onClick={() => setActiveTab('map')}>Map</button>
            <button className={`tab-btn${activeTab === 'plan' ? ' active' : ''}`} onClick={() => setActiveTab('plan')}>
              MSPV Plan {simReady && stats?.targetDay != null && <span className="tab-badge">{stats.targetDay}d</span>}
            </button>
          </div>

          {activeTab === 'map' && <>
            <div>
              <div className="daylabel">Day {dayIdx}</div>
              <div className="datelabel">{fmtDate(TODAY, dayIdx)}</div>
            </div>
            <input id="slider" type="range" min={0} max={sim ? sim.snapshots.length - 1 : 0} value={dayIdx}
              onChange={e => setDayIdx(+e.target.value)} disabled={!sim || sim.snapshots.length <= 1} style={{ flex: 1 }}
              onWheel={e => { e.preventDefault(); setDayIdx(i => Math.max(0, Math.min((sim?.snapshots.length ?? 1) - 1, i + (e.deltaY > 0 ? 1 : -1)))) }} />
            <div style={{ display: 'flex', gap: 4 }}>
              <button className="daystep" onClick={() => setDayIdx(i => Math.max(0, i - 1))}>◀</button>
              <button className="daystep" onClick={() => setDayIdx(i => Math.min((sim?.snapshots.length ?? 1) - 1, i + 1))}>▶</button>
            </div>
          </>}
        </div>

        {activeTab === 'map' ? (
          <>
            <div className="map-area">
              <MapCanvas
                derived={derived}
                layerLabels={layerLabels} setLayerLabels={setLayerLabels}
                layerTableLabels={layerTableLabels} setLayerTableLabels={setLayerTableLabels}
                zoneSatisfiedDay={sim?.zoneSatisfiedDay} dayIdx={dayIdx}
              />
              <Legend />
            </div>
            <BottomStats
              sim={sim} stats={stats} snap={snap} fmt={fmt}
              zonePriority={zonePriority} zoneThresholds={zoneThresholds}
              dayIdx={dayIdx} dailyThroughput={dailyThroughput} dailyWorkers={dailyWorkers}
            />
          </>
        ) : (
          <PlanTab planData={planData} zones={ZONES} today={TODAY} />
        )}
      </div>
    </>
  )
}
