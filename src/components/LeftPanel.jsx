import { useState, useRef, useEffect } from 'react'
import { ZONES, TOTAL_TABLES, TOTAL_MWP, TOTAL_BY_ZONE } from '../data.js'
import SaveLoad from './SaveLoad.jsx'

const MWP_PER_TABLE = TOTAL_MWP / TOTAL_TABLES

// ── Controlled number input (allows clearing to type a new value) ────────────
function NumInput({ value, onChange, min, max, step = 1, className, style }) {
  const [str, setStr] = useState(String(value))
  useEffect(() => { setStr(String(value)) }, [value])
  const parse = s => step < 1 ? parseFloat(s) : parseInt(s, 10)
  return (
    <input type="text" inputMode="decimal"
      className={className} style={style}
      value={str}
      onFocus={e => e.target.select()}
      onChange={e => {
        const raw = e.target.value
        setStr(raw)
        const n = parse(raw)
        if (!isNaN(n) && raw.trim() !== '') {
          const clamped = Math.min(max ?? Infinity, Math.max(min ?? -Infinity, n))
          onChange(clamped)
        }
      }}
      onBlur={() => {
        const n = parse(str)
        if (isNaN(n) || str.trim() === '') {
          setStr(String(value))
        } else {
          const clamped = Math.min(max ?? Infinity, Math.max(min ?? -Infinity, n))
          setStr(String(clamped))
          onChange(clamped)
        }
      }}
    />
  )
}

// ── Collapsible section ──────────────────────────────────────────────────────
function Section({ title, children, defaultOpen = true }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div>
      <div className={`sec-head${open ? ' open' : ''}`} onClick={() => setOpen(o => !o)}>
        <span>{title}</span><span className="arrow">▸</span>
      </div>
      {open && children}
    </div>
  )
}

// ── VRE threshold input ──────────────────────────────────────────────────────
function VreInput({ value, onChange }) {
  const [str, setStr] = useState(String(value))
  useEffect(() => { setStr(String(value)) }, [value])
  return (
    <input className="vre" type="text" inputMode="numeric"
      value={str} onFocus={e => e.target.select()}
      onChange={e => {
        const raw = e.target.value.replace(/\D/g, '').slice(0, 3)
        setStr(raw)
        const n = parseInt(raw, 10)
        if (!isNaN(n) && n >= 0 && n <= 100) onChange(n)
      }}
      onBlur={() => {
        const n = parseInt(str, 10)
        if (!str || isNaN(n) || n < 0) { setStr('0'); onChange(0) }
        else if (n > 100) { setStr('100'); onChange(100) }
        else setStr(String(n))
      }} />
  )
}

const VRE_DEFAULTS = { 1: 73, 2: 90, 3: 90, 4: 85, 5: 55, 6: 72, 7: 80, 8: 82, 9: 80 }

// ── Zone priority list ───────────────────────────────────────────────────────
function ZoneList({ zonePriority, setZonePriority, zoneThresholds, setZoneThresholds, snap }) {
  const dragIdx = useRef(null)
  function onDragStart(i) { dragIdx.current = i }
  function onDragOver(e, i) {
    e.preventDefault()
    if (dragIdx.current === null || dragIdx.current === i) return
    const from = dragIdx.current
    dragIdx.current = i
    setZonePriority(prev => {
      const next = [...prev]; const [item] = next.splice(from, 1); next.splice(i, 0, item); return next
    })
  }
  function onDragEnd() { dragIdx.current = null }

  return (
    <div>
      {zonePriority.map((z, i) => {
        const total = TOTAL_BY_ZONE[z]
        const totalMwp = (total * MWP_PER_TABLE).toFixed(2)
        let mwLabel = `${totalMwp} MW`
        if (snap) {
          const r = snap.remaining[z]
          const done = total - r.ms - r.pvA - r.pvB - (r.pvPending || 0)
          mwLabel = `${(done * MWP_PER_TABLE).toFixed(2)}/${totalMwp}`
        }
        return (
          <div key={z} className="zone-row"
            draggable onDragStart={() => onDragStart(i)} onDragOver={e => onDragOver(e, i)} onDragEnd={onDragEnd}>
            <span className="grip">⠿</span>
            <span className="zn">#{i + 1}</span>
            <span style={{ flex: 1 }}>MVPS {z}</span>
            <span className="small" style={{ color: 'var(--muted)', marginRight: 2 }}>{mwLabel} MW</span>
            <VreInput value={zoneThresholds[z] ?? 100}
              onChange={v => setZoneThresholds(prev => ({ ...prev, [z]: v }))} />
            <span className="small">%</span>
          </div>
        )
      })}
      <div className="vre-footer" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 6 }}>
        <span className="small">Drag to reorder · % = min. VRE</span>
        <div style={{ display: 'flex', gap: 6, width: '100%' }}>
          <button className="reset-btn" style={{ flex: 1 }} onClick={() => setZonePriority(prev => [...prev].reverse())}>↕ Reverse order</button>
          <button className="reset-btn" style={{ flex: 1 }} onClick={() => setZoneThresholds({ ...VRE_DEFAULTS })}>Reset to min. VRE</button>
          <button className="reset-btn" style={{ flex: 1 }} onClick={() => setZoneThresholds(Object.fromEntries(Object.keys(VRE_DEFAULTS).map(z => [z, 100])))}>All VRE 100%</button>
        </div>
      </div>
    </div>
  )
}

// ── Workforce calendar ───────────────────────────────────────────────────────
function WorkforceCalendar({ globalDeadline, generalCalOverrides, setGeneralCalOverrides,
  workerBatches, setWorkerBatches, generalWorkers, sundayWorkersPct, today,
  nonProdPct, calApplyNonProd, setCalApplyNonProd }) {

  const [addFrom,  setAddFrom]  = useState(today)
  const [addCount, setAddCount] = useState('')
  const [addLabel, setAddLabel] = useState('')

  const days = []
  const end = new Date(globalDeadline)
  for (let d = new Date(today), i = 0; d <= end && i < 365; d.setDate(d.getDate() + 1), i++) {
    days.push(d.toISOString().slice(0, 10))
  }

  const computedWorkers = date => {
    const isSunday = new Date(date).getDay() === 0
    const batchTotal = workerBatches.filter(b => b.fromDate <= date).reduce((s, b) => s + b.count, 0)
    const baseTotal = generalWorkers + batchTotal
    let w = isSunday ? Math.round(baseTotal * sundayWorkersPct / 100) : baseTotal
    if (calApplyNonProd) w = Math.round(w * (1 - Math.max(0, Math.min(100, nonProdPct)) / 100))
    return w
  }

  const handleAdd = () => {
    const n = parseInt(addCount, 10)
    if (!n || n === 0) return
    setWorkerBatches(prev => [...prev, { id: Date.now(), fromDate: addFrom, count: n, label: addLabel || null }])
    setAddCount(''); setAddLabel('')
  }

  return (
    <>
      {/* ── Non-productive toggle ───────────────── */}
      <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10, cursor: 'pointer', width: 'fit-content' }}>
        <input type="checkbox" checked={calApplyNonProd} onChange={e => setCalApplyNonProd(e.target.checked)}
          style={{ width: 13, height: 13, accentColor: 'var(--ok)', cursor: 'pointer' }} />
        <span className="stat-lbl" style={{ fontSize: 11 }}>Apply −{nonProdPct}% non-productive</span>
      </label>

      {/* ── Crew list ───────────────────────────── */}
      <div className="crew-list">
        <div className="crew-row crew-base">
          <span className="crew-dot" style={{ background: 'var(--accent)' }} />
          <span className="crew-label">Base crew</span>
          <span className="crew-count">{generalWorkers}</span>
          <span className="crew-meta">workers · all days</span>
        </div>
        {workerBatches.map(b => (
          <div key={b.id} className="crew-row">
            <span className="crew-dot" style={{ background: 'var(--ok)' }} />
            <span className="crew-label">{b.label || 'Addition'}</span>
            <span className="crew-count" style={{ color: 'var(--ok)' }}>+{b.count}</span>
            <span className="crew-meta">from {b.fromDate}</span>
            <button className="crew-remove" onClick={() => setWorkerBatches(prev => prev.filter(x => x.id !== b.id))}>×</button>
          </div>
        ))}
      </div>

      {/* ── Add form (2-row) ─────────────────────── */}
      <div className="crew-add-card">
        <div className="crew-add-r1">
          <div className="crew-add-field">
            <span className="crew-add-lbl">From date</span>
            <input type="date" className="crew-add-in" value={addFrom} onChange={e => setAddFrom(e.target.value)} />
          </div>
          <div className="crew-add-field">
            <span className="crew-add-lbl">Workers</span>
            <input type="number" className="crew-add-in crew-add-in-sm" value={addCount} placeholder="+n" onChange={e => setAddCount(e.target.value)} />
          </div>
        </div>
        <div className="crew-add-r2">
          <div className="crew-add-field" style={{ flex: 1 }}>
            <span className="crew-add-lbl">Label (optional)</span>
            <input type="text" className="crew-add-in" value={addLabel} placeholder="e.g. New subcontractor" onChange={e => setAddLabel(e.target.value)} />
          </div>
          <div style={{ paddingTop: 16 }}>
            <button className="crew-add-btn" onClick={handleAdd}>Add</button>
          </div>
        </div>
      </div>

      {/* ── Daily table ─────────────────────────── */}
      <div id="calWrap">
        <table className="cal">
          <thead><tr><th>Date</th><th>Workers</th></tr></thead>
          <tbody>
            {days.map(date => {
              const computed = computedWorkers(date)
              const override = generalCalOverrides[date]
              const display  = override !== undefined ? override : computed
              const isOvr    = override !== undefined && override !== computed
              return (
                <tr key={date} className={isOvr ? 'cal-overridden' : ''}>
                  <td>{date}</td>
                  <td>
                    <input type="number" min={0} value={display}
                      style={isOvr ? { borderColor: 'var(--warn)', color: 'var(--warn)' } : {}}
                      onChange={e => {
                        const val = +e.target.value
                        setGeneralCalOverrides(prev => {
                          const next = { ...prev }
                          if (val === computed) delete next[date]; else next[date] = val
                          return next
                        })
                      }} />
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </>
  )
}

// ── Manpower quick calculator ─────────────────────────────────────────────────
function ManpowerCalc({ stats, today, generalRateMs, generalRatePv, sundayWorkersPct, nonProdPct }) {
  const [targetDate, setTargetDate] = useState(today)
  const [localRateMs, setLocalRateMs] = useState(generalRateMs)
  const [localRatePv, setLocalRatePv] = useState(generalRatePv)

  const result = (() => {
    const end = new Date(targetDate), start = new Date(today)
    if (end <= start || !stats) return null
    let workDays = 0
    for (let d = new Date(start); d < end; d.setDate(d.getDate() + 1))
      workDays += d.getDay() === 0 ? sundayWorkersPct / 100 : 1
    if (workDays <= 0) return null
    const wdMs = localRateMs > 0 ? stats.totalMs / localRateMs : 0
    const wdPv = localRatePv > 0 ? stats.totalPv / localRatePv : 0
    return { workDays: Math.round(workDays), workers: (wdMs + wdPv) / workDays }
  })()

  const calDays = Math.round((new Date(targetDate) - new Date(today)) / 86400000)

  return (
    <div>
      {/* Rate boxes — same style as main panel */}
      <div className="rate-grid" style={{ marginBottom: 10 }}>
        <div className="rate-box rate-box-ms">
          <div className="rate-box-label">MS rate</div>
          <NumInput value={localRateMs} onChange={setLocalRateMs} min={0} step={0.01} className="rate-box-input" />
          <div className="rate-box-unit">tables / person / day</div>
        </div>
        <div className="rate-box rate-box-pv">
          <div className="rate-box-label">PV rate</div>
          <NumInput value={localRatePv} onChange={setLocalRatePv} min={0} step={0.01} className="rate-box-input" />
          <div className="rate-box-unit">tables / person / day</div>
        </div>
      </div>

      {/* Target date */}
      <div className="stat-row">
        <span className="stat-lbl">Target date</span>
        <input type="date" value={targetDate} onChange={e => setTargetDate(e.target.value)} />
      </div>

      {/* Result */}
      {result ? (
        <div className="qc-result">
          <div className="qc-row"><span>Calendar days</span><span>{calDays}</span></div>
          <div className="qc-row"><span>Working days</span><span>{result.workDays}</span></div>
          <div className="qc-divider" />
          <div className="qc-main-row">
            <span>Productive workers needed</span>
            <span className="qc-workers">{Math.ceil(result.workers)}</span>
          </div>
          <div className="qc-note">≈ {result.workers.toFixed(1)} · rounded up</div>
          {nonProdPct > 0 && (
            <div className="qc-note" style={{ color: 'var(--muted)' }}>
              Total incl. {nonProdPct}% non-prod: {Math.ceil(result.workers / (1 - nonProdPct / 100))}
            </div>
          )}
        </div>
      ) : (
        <div className="stat-hint" style={{ textAlign: 'center', marginTop: 8 }}>
          {!stats ? 'Run simulation first.' : 'Set a future date.'}
        </div>
      )}
    </div>
  )
}

// ── Main panel ───────────────────────────────────────────────────────────────
export default function LeftPanel({
  generalWorkers, setGeneralWorkers,
  generalRateMs, setGeneralRateMs,
  generalRatePv, setGeneralRatePv,
  sundayWorkersPct, setSundayWorkersPct,
  workerBatches, setWorkerBatches,
  snap, stats, fmt,
  zonePriority, setZonePriority, zoneThresholds, setZoneThresholds,
  globalDeadline,
  targetPct, setTargetPct,
  generalCalOverrides, setGeneralCalOverrides,
  onRun, simReady, simDays, today,
  sheetStatus, sheetDate, onRefreshSheet,
  nonProdPct, setNonProdPct,
  calApplyNonProd, setCalApplyNonProd,
  effectiveWorkers,
  getConfig, applyConfig,
}) {
  const tPct         = Math.max(1, Math.min(100, targetPct))
  const targetTables = Math.ceil(TOTAL_TABLES * tPct / 100)
  const targetMwp    = (targetTables * TOTAL_MWP / TOTAL_TABLES).toFixed(2)
  const statusColor  = stats?.targetStatus === 'ok' ? 'var(--ok)' : stats?.targetStatus === 'bad' ? 'var(--bad)' : 'var(--accent)'
  const msCapacity   = Math.round(effectiveWorkers * generalRateMs)
  const pvCapacity   = Math.round(effectiveWorkers * generalRatePv)

  return (
    <div className="col">
      <h1>Solar Valley Solar Project</h1>
      <div className="small">MSPV plan simulator</div>
      <div className="sheet-status">
        <span className={`ss-pill ss-pill-${sheetStatus}`}>
          {sheetStatus === 'loading' && '⏳ Loading…'}
          {sheetStatus === 'ok'      && <>✓ Synced<span className="ss-pill-date"> · Last update: {sheetDate?.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}</span></>}
          {sheetStatus === 'error'   && '⚠ Offline'}
        </span>
        {sheetStatus !== 'loading' && (
          <button className="ss-refresh" onClick={onRefreshSheet} title="Refresh from tracker">↻</button>
        )}
        <SaveLoad getConfig={getConfig} applyConfig={applyConfig} />
      </div>

      {/* ── Manpower & productivity ─────────────────────── */}
      <Section title="Manpower & productivity" defaultOpen={true}>

        {/* Workers — W2 layout (total + non-productive %) */}
        <div className="stat-row">
          <span className="stat-lbl">Workers</span>
          <NumInput value={generalWorkers} onChange={setGeneralWorkers} min={0} className="stat-val-input" style={{ width: 90 }} />
        </div>
        <div className="stat-row" style={{ marginTop: 2 }}>
          <span className="stat-lbl" style={{ color: 'var(--muted)', fontSize: 11 }}>Non-productive (managers, supervisors, foremen…)</span>
          <div style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}>
            <NumInput value={nonProdPct} onChange={v => setNonProdPct(Math.max(0, Math.min(100, v)))}
              min={0} max={100} className="stat-val-input" style={{ width: 90, paddingRight: 22 }} />
            <span style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none', color: 'var(--muted)', fontSize: 12 }}>%</span>
          </div>
        </div>
        <div style={{ height: 1, background: 'var(--line)', margin: '6px 0' }} />
        <div className="stat-row" style={{ marginBottom: 4, justifyContent: 'flex-end' }}>
          <span className="stat-hint" style={{ marginBottom: 0 }}>= {effectiveWorkers} productive workers</span>
        </div>

        {/* MS / PV rate boxes */}
        <div className="rate-grid">
          <div className="rate-box rate-box-ms">
            <div className="rate-box-label">MS rate</div>
            <NumInput value={generalRateMs} onChange={setGeneralRateMs} min={0} step={0.01} className="rate-box-input" />
            <div className="rate-box-unit">tables / person / day</div>
            <div className="rate-box-cap" style={{ color: 'var(--warn)' }}>{msCapacity} tables/day</div>
          </div>
          <div className="rate-box rate-box-pv">
            <div className="rate-box-label">PV rate</div>
            <NumInput value={generalRatePv} onChange={setGeneralRatePv} min={0} step={0.01} className="rate-box-input" />
            <div className="rate-box-unit">tables / person / day</div>
            <div className="rate-box-cap" style={{ color: 'var(--accent)' }}>{pvCapacity} tables/day</div>
          </div>
        </div>

        {/* Sundays */}
        <div className="stat-row" style={{ marginTop: 2, alignItems: 'flex-start' }}>
          <span className="stat-lbl" style={{ paddingTop: 8 }}>Sunday crew</span>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
            <div style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}>
              <NumInput value={sundayWorkersPct} onChange={v => setSundayWorkersPct(Math.max(0, Math.min(100, v)))}
                min={0} max={100} className="stat-val-input" style={{ width: 90, paddingRight: 22 }} />
              <span style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none', color: 'var(--muted)', fontSize: 12 }}>%</span>
            </div>
            <span className="stat-hint" style={{ marginBottom: 0 }}>
              {sundayWorkersPct === 0
                ? '⚠ No work on Sundays'
                : `= ${Math.round(generalWorkers * sundayWorkersPct / 100)} workers`}
            </span>
          </div>
        </div>

        {/* Target / completion card */}
        <div className="tc-card">
          <div className="tc-top">
            <div className="tc-left">
              <div className="tc-eyebrow">Target</div>
              <div className="tc-pct-row">
                <NumInput value={targetPct} onChange={v => setTargetPct(Math.max(1, Math.min(100, v)))}
                  min={1} max={100} className="tc-pct-input" />
                <span className="tc-pct-sign">%</span>
              </div>
              <div className="tc-sub">{targetTables.toLocaleString()} tables · {targetMwp} MWp</div>
            </div>
            <div className="tc-sep" />
            <div className="tc-right">
              <div className="tc-eyebrow">Completion</div>
              {stats
                ? <>
                    <div className="tc-date" style={{ color: statusColor }}>{fmt(stats.targetDay)}</div>
                    <div className="tc-days">{stats.targetDay} days</div>
                  </>
                : <div className="tc-date-empty">run sim ▶</div>
              }
            </div>
          </div>
        </div>

      </Section>

      {/* ── Daily workforce calendar ─────────────────── */}
      <Section title="Daily workforce calendar" defaultOpen={false}>
        <WorkforceCalendar
          globalDeadline={globalDeadline}
          generalCalOverrides={generalCalOverrides} setGeneralCalOverrides={setGeneralCalOverrides}
          workerBatches={workerBatches} setWorkerBatches={setWorkerBatches}
          generalWorkers={generalWorkers} sundayWorkersPct={sundayWorkersPct}
          today={today}
          nonProdPct={nonProdPct} calApplyNonProd={calApplyNonProd} setCalApplyNonProd={setCalApplyNonProd}
        />
      </Section>

      {/* ── MVPS priority ─────────────────────────────── */}
      <Section title="MVPS priority & VRE threshold" defaultOpen={false}>
        <ZoneList zonePriority={zonePriority} setZonePriority={setZonePriority}
          zoneThresholds={zoneThresholds} setZoneThresholds={setZoneThresholds} snap={snap} />
      </Section>

      <div className="qc-separator" />

      {/* ── Manpower calculator ───────────────────────── */}
      <Section title="Manpower quick calculator" defaultOpen={false}>
        <div className="card">
          <ManpowerCalc stats={stats} today={today}
            generalRateMs={generalRateMs} generalRatePv={generalRatePv}
            sundayWorkersPct={sundayWorkersPct} nonProdPct={nonProdPct} />
        </div>
      </Section>

      <button className="run" onClick={onRun}>▶ Run simulation</button>
      {simReady && <div className="small" style={{ marginTop: 6, textAlign: 'center' }}>{simDays} days computed.</div>}
    </div>
  )
}
