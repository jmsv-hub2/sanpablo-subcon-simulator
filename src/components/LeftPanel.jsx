import { useState, useRef, useEffect } from 'react'
import { ZONES, TOTAL_TABLES, TOTAL_MWP, TOTAL_BY_ZONE } from '../data.js'

const MWP_PER_TABLE = TOTAL_MWP / TOTAL_TABLES

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
      }}
      title="VRE threshold %" />
  )
}

// ── Zone priority ────────────────────────────────────────────────────────────

function ZoneList({ zonePriority, setZonePriority, zoneThresholds, setZoneThresholds, snap }) {
  const dragIdx = useRef(null)

  function onDragStart(i) { dragIdx.current = i }
  function onDragOver(e, i) {
    e.preventDefault()
    if (dragIdx.current === null || dragIdx.current === i) return
    const from = dragIdx.current
    dragIdx.current = i
    setZonePriority(prev => {
      const next = [...prev]
      const [item] = next.splice(from, 1)
      next.splice(i, 0, item)
      return next
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
          const doneMwp = (done * MWP_PER_TABLE).toFixed(2)
          mwLabel = `${doneMwp}/${totalMwp}`
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
      <div className="small" style={{ marginTop: 4 }}>Drag to reorder · % = minimum VRE threshold</div>
    </div>
  )
}

// ── Workforce calendar (general mode only) ───────────────────────────────────

function WorkforceCalendar({ globalDeadline, generalCalOverrides, setGeneralCalOverrides, today }) {
  const days = []
  const end = new Date(globalDeadline)
  for (let d = new Date(today), i = 0; d <= end && i < 365; d.setDate(d.getDate() + 1), i++) {
    days.push(d.toISOString().slice(0, 10))
  }
  return (
    <div id="calWrap">
      <table className="cal">
        <thead><tr><th>Date</th><th>Workers (override)</th></tr></thead>
        <tbody>
          {days.map(date => (
            <tr key={date}>
              <td>{date}</td>
              <td>
                <input type="number" min={0}
                  value={generalCalOverrides[date] !== undefined ? generalCalOverrides[date] : ''}
                  placeholder="—"
                  onChange={e => setGeneralCalOverrides(prev => {
                    const next = { ...prev }
                    if (e.target.value === '') delete next[date]
                    else next[date] = +e.target.value
                    return next
                  })} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ── Main left panel ──────────────────────────────────────────────────────────

export default function LeftPanel({
  generalWorkers, setGeneralWorkers,
  generalRateMs, setGeneralRateMs,
  generalRatePv, setGeneralRatePv,
  sundayWorkersPct, setSundayWorkersPct,
  snap, stats, fmt,
  zonePriority, setZonePriority, zoneThresholds, setZoneThresholds,
  globalDeadline,
  targetPct, setTargetPct,
  generalCalOverrides, setGeneralCalOverrides,
  onRun, simReady, simDays, today,
}) {
  const tPct = Math.max(1, Math.min(100, targetPct))
  const targetTables = Math.round(TOTAL_TABLES * tPct / 100)
  const targetMwp    = (targetTables * TOTAL_MWP / TOTAL_TABLES).toFixed(2)

  const statusColor = stats?.targetStatus === 'ok' ? 'var(--ok)' : stats?.targetStatus === 'bad' ? 'var(--bad)' : 'var(--text)'

  return (
    <div className="col">
      <h1>San Pablo Solar</h1>
      <div className="small">Subcontractor allocation simulator</div>

      <Section title="Manpower & productivity">
        <div className="card">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, fontSize: 11 }}>
            <div style={{ gridColumn: '1 / -1' }}>
              <div className="small" style={{ marginBottom: 2 }}>Manpower</div>
              <input type="number" min={0} value={generalWorkers} onChange={e => setGeneralWorkers(+e.target.value)} onFocus={e => e.target.select()} />
            </div>
            <div>
              <div className="small" style={{ marginBottom: 2 }}>MS rate (t/p/d)</div>
              <input type="number" min={0} step={0.01} value={generalRateMs} onChange={e => setGeneralRateMs(+e.target.value)} onFocus={e => e.target.select()} />
            </div>
            <div>
              <div className="small" style={{ marginBottom: 2 }}>PV rate (t/p/d)</div>
              <input type="number" min={0} step={0.01} value={generalRatePv} onChange={e => setGeneralRatePv(+e.target.value)} onFocus={e => e.target.select()} />
            </div>
            <div style={{ gridColumn: '1 / -1', display: 'flex', alignItems: 'center', gap: 6 }}>
              <div className="small" style={{ flex: 1 }}>Sundays</div>
              <input type="number" min={0} max={100} value={sundayWorkersPct} style={{ width: 46 }}
                onChange={e => setSundayWorkersPct(Math.max(0, Math.min(100, +e.target.value)))} onFocus={e => e.target.select()} />
              <span className="small">% · 0 = no work</span>
            </div>
          </div>
        </div>
      </Section>

      <div className="card" style={{ fontSize: 11 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
          <div>
            <div className="small muted" style={{ marginBottom: 2 }}>Target %</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <input type="number" min={1} max={100} value={targetPct} style={{ width: '100%' }}
                onChange={e => setTargetPct(Math.max(1, Math.min(100, +e.target.value)))} onFocus={e => e.target.select()} />
              <span className="small">%</span>
            </div>
            <div className="small muted" style={{ marginTop: 2 }}>{targetTables.toLocaleString()} t · {targetMwp} MWp</div>
          </div>
          <div>
            <div className="small muted" style={{ marginBottom: 2 }}>Target {tPct}%</div>
            {stats ? (
              <>
                <div style={{ fontWeight: 600, color: statusColor }}>{fmt(stats.targetDay)}</div>
                <div className="small muted" style={{ marginTop: 2 }}>{tPct}% = {targetMwp} MWp</div>
              </>
            ) : (
              <div className="small" style={{ color: 'var(--warn)' }}>▶ Run simulation</div>
            )}
          </div>
        </div>
      </div>

      <Section title="MVPS priority & VRE threshold">
        <ZoneList zonePriority={zonePriority} setZonePriority={setZonePriority}
          zoneThresholds={zoneThresholds} setZoneThresholds={setZoneThresholds}
          snap={snap} />
      </Section>

      <Section title="Manpower calculator" defaultOpen={false}>
        <div className="card" style={{ fontSize: 11 }}>
          <div className="small muted" style={{ marginBottom: 6 }}>Workers needed to finish by a target date</div>
          <ManpowerCalc stats={stats} today={today} generalRateMs={generalRateMs} generalRatePv={generalRatePv} sundayWorkersPct={sundayWorkersPct} />
        </div>
      </Section>

      <Section title="Daily workforce calendar" defaultOpen={false}>
        <div className="small" style={{ marginBottom: 6 }}>Leave blank to use base manpower.</div>
        <WorkforceCalendar
          globalDeadline={globalDeadline}
          generalCalOverrides={generalCalOverrides} setGeneralCalOverrides={setGeneralCalOverrides}
          today={today}
        />
      </Section>

      <button className="run" onClick={onRun}>▶ Run simulation</button>
      {simReady && <div className="small" style={{ marginTop: 6, textAlign: 'center' }}>{simDays} days computed.</div>}
    </div>
  )
}

// ── Manpower calculator ──────────────────────────────────────────────────────

function ManpowerCalc({ stats, today, generalRateMs, generalRatePv, sundayWorkersPct }) {
  const [targetDate, setTargetDate] = useState(() => {
    const d = new Date(today); d.setDate(d.getDate() + 180); return d.toISOString().slice(0, 10)
  })

  const result = (() => {
    const end = new Date(targetDate)
    const start = new Date(today)
    if (end <= start) return null
    let workDays = 0
    for (let d = new Date(start); d < end; d.setDate(d.getDate() + 1)) {
      workDays += d.getDay() === 0 ? sundayWorkersPct / 100 : 1
    }
    if (workDays <= 0 || !stats) return null
    const wdMs = generalRateMs > 0 ? stats.totalMs / generalRateMs : 0
    const wdPv = generalRatePv > 0 ? stats.totalPv / generalRatePv : 0
    const workers = (wdMs + wdPv) / workDays
    return { workDays: Math.round(workDays), workers }
  })()

  const calDays = Math.round((new Date(targetDate) - new Date(today)) / 86400000)

  return (
    <>
      <div className="deadline-row">
        <div>Target date</div>
        <input type="date" value={targetDate} onChange={e => setTargetDate(e.target.value)} />
      </div>
      {result ? (
        <div style={{ marginTop: 6, padding: '6px 8px', background: 'var(--bg)', borderRadius: 4 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
            <span className="muted">Calendar days</span><span>{calDays}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
            <span className="muted">Working days</span><span>{result.workDays}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700, fontSize: 13 }}>
            <span>Workers needed</span>
            <span style={{ color: 'var(--accent)' }}>{Math.ceil(result.workers)}</span>
          </div>
          <div className="small muted" style={{ marginTop: 3 }}>≈ {result.workers.toFixed(1)} · rounded up</div>
        </div>
      ) : (
        <div className="small muted" style={{ marginTop: 4 }}>Run simulation first, then set a future date.</div>
      )}
    </>
  )
}
