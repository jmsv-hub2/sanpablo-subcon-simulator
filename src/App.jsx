import { useState, useMemo, useCallback, useEffect } from 'react'
import { ZONES, SUBS_RAW, TABLES, TABLES_BY_ZONE, TOTAL_TABLES, TOTAL_MWP, MWP_PER_TABLE, TOTAL_BY_ZONE } from './data.js'
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
  // ── Input mode: general (one set of values) or per-sub ──
  const [inputMode, setInputMode] = useState('general') // 'general' | 'perSub'

  // ── General mode values ──
  const [generalWorkers, setGeneralWorkers] = useState(10)
  const [generalRate, setGeneralRate]       = useState(0.35)

  // ── Per-sub configs (workers/prodMs/prodPv/pvOnly per sub) ──
  const [subsConfig, setSubsConfig] = useState(() =>
    SUBS_RAW.map(s => ({ name: s.name, color: s.color, selected: true, workers: 10, prodMs: 0.35, prodPv: 0.35, pvOnly: false }))
  )

  // ── Zones ──
  const [zonePriority, setZonePriority]     = useState([...ZONES])
  const [zoneThresholds, setZoneThresholds] = useState(() => Object.fromEntries(ZONES.map(z => [z, 100])))

  // ── Deadline / target ──
  const [globalDeadline, setGlobalDeadline] = useState(defaultDeadline)
  const [targetPct, setTargetPct]           = useState(100)

  // ── Calendar overrides — two separate stores ──
  const [generalCalOverrides, setGeneralCalOverrides]   = useState({}) // { 'YYYY-MM-DD': workers }
  const [perSubCalOverrides,  setPerSubCalOverrides]    = useState({}) // { 'subName|YYYY-MM-DD': workers }

  // ── Layer toggles ──
  const [layerPhase, setLayerPhase] = useState(true)
  const [layerSub,   setLayerSub]   = useState(true)

  // ── Simulation result ──
  const [sim, setSim]       = useState(null)
  const [dayIdx, setDayIdx] = useState(0)

  // ── Active subs resolved with mode-specific values ──
  const activeSubs = useMemo(() => {
    const selected = subsConfig.filter(s => s.selected)
    if (inputMode === 'general') {
      return selected.map(s => ({ ...s, workers: generalWorkers, prodMs: generalRate, prodPv: generalRate }))
    }
    return selected
  }, [subsConfig, inputMode, generalWorkers, generalRate])

  // ── Workforce overrides resolved for the engine ──
  const workforceOverrides = useMemo(() => {
    if (inputMode === 'general') {
      const result = {}
      const selectedNames = subsConfig.filter(s => s.selected).map(s => s.name)
      Object.entries(generalCalOverrides).forEach(([date, w]) => {
        selectedNames.forEach(name => { result[`${name}|${date}`] = w })
      })
      return result
    }
    return perSubCalOverrides
  }, [inputMode, generalCalOverrides, perSubCalOverrides, subsConfig])

  // ── Initial render: show real data state (simulate 0 days) ──
  useEffect(() => {
    const result = simulate({ tables: TABLES, zones: ZONES, zonePriority: [...ZONES], zoneThresholds: Object.fromEntries(ZONES.map(z => [z, 100])), activeSubs: [], workforceOverrides: {}, startDate: TODAY, maxDays: 0 })
    setSim(result)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const runSim = useCallback(() => {
    const result = simulate({ tables: TABLES, zones: ZONES, zonePriority, zoneThresholds, activeSubs, workforceOverrides, startDate: TODAY, maxDays: 800 })
    setSim(result)
    setDayIdx(0)
  }, [zonePriority, zoneThresholds, activeSubs, workforceOverrides])

  // ── Derived visual state ──
  const derived = useMemo(() => {
    if (!sim) return null
    return deriveDay(sim.snapshots[dayIdx], TABLES_BY_ZONE, ZONES)
  }, [sim, dayIdx])

  const snap = sim?.snapshots[dayIdx] ?? null

  // ── Stats (computed once per day, passed to BottomStats) ──
  const stats = useMemo(() => {
    if (!sim || !derived || !snap) return null
    let totalMs = 0, totalPv = 0
    ZONES.forEach(z => { totalMs += snap.remaining[z].ms; totalPv += snap.remaining[z].pvA + snap.remaining[z].pvB })
    const pvDoneCount = TABLES.filter(t => derived.phase[t.id] >= 5).length
    const completedMwp = pvDoneCount * MWP_PER_TABLE
    const globalCompletionDay = ZONES.every(z => sim.zoneCompletionDay[z] !== undefined)
      ? Math.max(...ZONES.map(z => sim.zoneCompletionDay[z])) : null
    const gd = new Date(globalDeadline)
    const globalStatus = globalCompletionDay !== null
      ? ((new Date(TODAY).setDate(new Date(TODAY).getDate() + globalCompletionDay), new Date(TODAY)) <= gd ? 'ok' : 'bad')
      : 'unknown'
    const tPct = Math.max(1, Math.min(100, targetPct))
    const targetTables = Math.round(TOTAL_TABLES * tPct / 100)
    let targetDay = null
    for (const s of sim.snapshots) {
      let done = 0
      ZONES.forEach(z => { done += TABLES_BY_ZONE[z].length - s.remaining[z].ms - s.remaining[z].pvA - s.remaining[z].pvB })
      if (done >= targetTables) { targetDay = s.day; break }
    }
    const targetDate = targetDay !== null ? new Date(TODAY) : null
    if (targetDate) targetDate.setDate(targetDate.getDate() + targetDay)
    const targetStatus = targetDate ? (targetDate <= gd ? 'ok' : 'bad') : 'unknown'

    const globalCompletionDate = globalCompletionDay !== null ? (() => { const d = new Date(TODAY); d.setDate(d.getDate() + globalCompletionDay); return d })() : null
    const realGlobalStatus = globalCompletionDate ? (globalCompletionDate <= gd ? 'ok' : 'bad') : 'unknown'

    return { totalMs, totalPv, pvDoneCount, completedMwp, globalCompletionDay, globalStatus: realGlobalStatus, targetDay, targetStatus, tPct, targetTables }
  }, [sim, derived, snap, globalDeadline, targetPct])

  const fmt = (offset) => offset !== null && offset !== undefined ? fmtDate(TODAY, offset) : '—'

  return (
    <>
      <LeftPanel
        inputMode={inputMode} setInputMode={setInputMode}
        generalWorkers={generalWorkers} setGeneralWorkers={setGeneralWorkers}
        generalRate={generalRate} setGeneralRate={setGeneralRate}
        subsConfig={subsConfig} setSubsConfig={setSubsConfig}
        zonePriority={zonePriority} setZonePriority={setZonePriority}
        zoneThresholds={zoneThresholds} setZoneThresholds={setZoneThresholds}
        globalDeadline={globalDeadline} setGlobalDeadline={setGlobalDeadline}
        targetPct={targetPct} setTargetPct={setTargetPct}
        generalCalOverrides={generalCalOverrides} setGeneralCalOverrides={setGeneralCalOverrides}
        perSubCalOverrides={perSubCalOverrides} setPerSubCalOverrides={setPerSubCalOverrides}
        activeSubs={activeSubs}
        onRun={runSim}
        simReady={!!sim && sim.snapshots.length > 1}
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
            subsConfig={subsConfig}
            layerPhase={layerPhase} setLayerPhase={setLayerPhase}
            layerSub={layerSub}     setLayerSub={setLayerSub}
          />
          <Legend activeSubs={activeSubs} />
        </div>

        <BottomStats sim={sim} stats={stats} snap={snap} fmt={fmt} subsConfig={subsConfig} />
      </div>
    </>
  )
}
