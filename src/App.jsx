import { useState, useMemo, useCallback, useEffect } from 'react'
import { ZONES, SUBS_RAW, TABLES, TABLES_BY_ZONE, TOTAL_TABLES, TOTAL_MWP, MWP_PER_TABLE } from './data.js'
import { simulate, deriveDay } from '../engine.js'
import LeftPanel from './components/LeftPanel.jsx'
import MapCanvas from './components/MapCanvas.jsx'
import RightPanel from './components/RightPanel.jsx'
import Legend from './components/Legend.jsx'

const TODAY = new Date().toISOString().slice(0, 10)
function defaultDeadline() {
  const d = new Date(); d.setDate(d.getDate() + 180); return d.toISOString().slice(0, 10)
}

function fmtDate(startDate, dayOffset) {
  const d = new Date(startDate)
  d.setDate(d.getDate() + dayOffset)
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}

export default function App() {
  // ── Productivity ──
  const [prodMode, setProdMode] = useState('common')
  const [commonMs, setCommonMs] = useState(0.35)
  const [commonPv, setCommonPv] = useState(0.35)

  // ── Subcontractors ──
  const [subsConfig, setSubsConfig] = useState(() =>
    SUBS_RAW.map(s => ({ name: s.name, color: s.color, selected: true, workers: 10, prodMs: 0.35, prodPv: 0.35, pvOnly: false }))
  )

  // ── Zones ──
  const [zonePriority, setZonePriority] = useState([...ZONES])
  const [zoneThresholds, setZoneThresholds] = useState(() => Object.fromEntries(ZONES.map(z => [z, 100])))

  // ── Deadline / target ──
  const [globalDeadline, setGlobalDeadline] = useState(defaultDeadline)
  const [targetPct, setTargetPct] = useState(100)

  // ── Workforce overrides ──
  const [workforceOverrides, setWorkforceOverrides] = useState({})

  // ── Layer toggles ──
  const [layerPhase, setLayerPhase] = useState(true)
  const [layerSub, setLayerSub]   = useState(true)
  const [layerCrew, setLayerCrew] = useState(true)

  // ── Simulation result ──
  const [sim, setSim] = useState(null)
  const [dayIdx, setDayIdx] = useState(0)

  // ── Active subs (resolved with prod rates) ──
  const activeSubs = useMemo(() =>
    subsConfig.filter(s => s.selected).map(s => ({
      ...s,
      prodMs: prodMode === 'common' ? commonMs : s.prodMs,
      prodPv: prodMode === 'common' ? commonPv : s.prodPv,
    }))
  , [subsConfig, prodMode, commonMs, commonPv])

  // ── Run simulation ──
  // Show real data state on initial load (0 days = just the real Excel phases)
  useEffect(() => {
    const result = simulate({ tables: TABLES, zones: ZONES, zonePriority, zoneThresholds, activeSubs: [], workforceOverrides: {}, startDate: TODAY, maxDays: 0 })
    setSim(result)
    setDayIdx(0)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const runSim = useCallback(() => {
    const result = simulate({
      tables: TABLES,
      zones: ZONES,
      zonePriority,
      zoneThresholds,
      activeSubs,
      workforceOverrides,
      startDate: TODAY,
      maxDays: 800,
    })
    setSim(result)
    setDayIdx(0)
  }, [zonePriority, zoneThresholds, activeSubs, workforceOverrides])

  // ── Derived state for current day ──
  const derived = useMemo(() => {
    if (!sim) return null
    return deriveDay(sim.snapshots[dayIdx], TABLES_BY_ZONE, ZONES)
  }, [sim, dayIdx])

  const snap = sim?.snapshots[dayIdx] ?? null

  // ── Stats helpers ──
  const stats = useMemo(() => {
    if (!sim || !derived || !snap) return null
    let totalMs = 0, totalPv = 0
    ZONES.forEach(z => { totalMs += snap.remaining[z].ms; totalPv += snap.remaining[z].pvA + snap.remaining[z].pvB })
    const pvDoneCount = TABLES.filter(t => derived.phase[t.id] >= 5).length
    const completedMwp = pvDoneCount * MWP_PER_TABLE

    const globalCompletionDay = ZONES.every(z => sim.zoneCompletionDay[z] !== undefined)
      ? Math.max(...ZONES.map(z => sim.zoneCompletionDay[z])) : null

    const gd = new Date(globalDeadline)
    let globalStatus = 'unknown'
    if (globalCompletionDay !== null) {
      const d = new Date(TODAY); d.setDate(d.getDate() + globalCompletionDay)
      globalStatus = d <= gd ? 'ok' : 'bad'
    }

    const tPct = Math.max(1, Math.min(100, targetPct))
    const targetTables = Math.round(TOTAL_TABLES * tPct / 100)
    let targetDay = null
    for (const s of sim.snapshots) {
      let done = 0
      ZONES.forEach(z => { done += TABLES_BY_ZONE[z].length - s.remaining[z].ms - s.remaining[z].pvA - s.remaining[z].pvB })
      if (done >= targetTables) { targetDay = s.day; break }
    }
    let targetStatus = 'unknown'
    if (targetDay !== null) {
      const d = new Date(TODAY); d.setDate(d.getDate() + targetDay)
      targetStatus = d <= gd ? 'ok' : 'bad'
    }

    return { totalMs, totalPv, pvDoneCount, completedMwp, globalCompletionDay, globalStatus, targetDay, targetStatus, tPct, targetTables }
  }, [sim, derived, snap, globalDeadline, targetPct])

  const fmt = (offset) => offset !== null && offset !== undefined ? fmtDate(TODAY, offset) : '— (not reached in range)'

  return (
    <>
      <LeftPanel
        prodMode={prodMode} setProdMode={setProdMode}
        commonMs={commonMs} setCommonMs={setCommonMs}
        commonPv={commonPv} setCommonPv={setCommonPv}
        subsConfig={subsConfig} setSubsConfig={setSubsConfig}
        zonePriority={zonePriority} setZonePriority={setZonePriority}
        zoneThresholds={zoneThresholds} setZoneThresholds={setZoneThresholds}
        globalDeadline={globalDeadline} setGlobalDeadline={setGlobalDeadline}
        targetPct={targetPct} setTargetPct={setTargetPct}
        workforceOverrides={workforceOverrides} setWorkforceOverrides={setWorkforceOverrides}
        activeSubs={activeSubs}
        onRun={runSim}
        simReady={!!sim}
        simDays={sim ? sim.snapshots.length - 1 : 0}
        today={TODAY}
      />

      <div className="mid-col">
        <div className="topbar">
          <div>
            <div className="daylabel">Day {dayIdx}</div>
            <div className="datelabel">{fmtDate(TODAY, dayIdx)}</div>
          </div>
          <input id="slider" type="range" min={0} max={sim ? sim.snapshots.length - 1 : 0} value={dayIdx}
            onChange={e => setDayIdx(+e.target.value)} disabled={!sim} />
          <div style={{ display: 'flex', gap: 4 }}>
            <button className="daystep" onClick={() => setDayIdx(i => Math.max(0, i - 1))} disabled={!sim}>◀</button>
            <button className="daystep" onClick={() => setDayIdx(i => Math.min((sim?.snapshots.length ?? 1) - 1, i + 1))} disabled={!sim}>▶</button>
          </div>
        </div>

        <MapCanvas
          derived={derived}
          assignment={snap?.assignment ?? null}
          subsConfig={subsConfig}
          layerPhase={layerPhase} setLayerPhase={setLayerPhase}
          layerSub={layerSub}   setLayerSub={setLayerSub}
          layerCrew={layerCrew} setLayerCrew={setLayerCrew}
        />

        <Legend activeSubs={activeSubs} />
      </div>

      <RightPanel
        sim={sim}
        stats={stats}
        snap={snap}
        fmt={fmt}
        subsConfig={subsConfig}
        globalDeadline={globalDeadline}
        targetPct={targetPct}
      />
    </>
  )
}
