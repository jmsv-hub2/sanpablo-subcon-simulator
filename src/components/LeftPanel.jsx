import { useState, useRef } from 'react'
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

// ── Mode toggle ─────────────────────────────────────────────────────────────

function ModeBar({ value, onChange }) {
  return (
    <div className="modebar">
      <label><input type="radio" name="inputMode" value="general" checked={value === 'general'} onChange={() => onChange('general')} /> General</label>
      <label><input type="radio" name="inputMode" value="perSub"  checked={value === 'perSub'}  onChange={() => onChange('perSub')}  /> Per subcontractor</label>
    </div>
  )
}

// ── Subcontractors ──────────────────────────────────────────────────────────

function SubsList({ subsConfig, setSubsConfig, inputMode }) {
  const [showInactive, setShowInactive] = useState(false)
  const active   = subsConfig.filter(s => s.selected)
  const inactive = subsConfig.filter(s => !s.selected)

  function update(idx, field, value) {
    setSubsConfig(prev => prev.map((s, i) => i === idx ? { ...s, [field]: value } : s))
  }
  function toggle(idx) {
    setSubsConfig(prev => prev.map((s, i) => i === idx ? { ...s, selected: !s.selected } : s))
  }

  return (
    <div className="card">
      {/* header — only show rate columns in perSub mode */}
      <div className={`sub-row ${inputMode === 'perSub' ? 'persub-mode' : 'general-sub-mode'}`}
        style={{ fontWeight: 600, color: 'var(--muted)', fontSize: 11 }}>
        <div /><div>Sub</div>
        {inputMode === 'perSub' && <><div>Workers</div><div>MS r.</div><div>PV r.</div></>}
        <div title="PV only">PV only</div>
      </div>

      {active.map(s => {
        const idx = subsConfig.indexOf(s)
        return (
          <div key={s.name} className={`sub-row ${inputMode === 'perSub' ? 'persub-mode' : 'general-sub-mode'}`}>
            <input type="checkbox" checked onChange={() => toggle(idx)} />
            <div className="sub-name"><span className="dot" style={{ background: s.color }} />{s.name}</div>
            {inputMode === 'perSub' && <>
              <input type="number" min={0} value={s.workers} onChange={e => update(idx, 'workers', +e.target.value)} />
              <input type="number" min={0} step={0.01} value={s.prodMs} onChange={e => update(idx, 'prodMs', +e.target.value)} />
              <input type="number" min={0} step={0.01} value={s.prodPv} onChange={e => update(idx, 'prodPv', +e.target.value)} />
            </>}
            <div className="pvonly">
              <input type="checkbox" checked={s.pvOnly} onChange={e => update(idx, 'pvOnly', e.target.checked)} title="Only installs PV on tables that already have MS done" />
            </div>
          </div>
        )
      })}

      {inactive.length > 0 && (
        <>
          <div className={`collapsible-head${showInactive ? ' open' : ''}`} onClick={() => setShowInactive(o => !o)}>
            <span className="arrow">▸</span> Inactive ({inactive.length})
          </div>
          {showInactive && inactive.map(s => {
            const idx = subsConfig.indexOf(s)
            return (
              <div key={s.name} className="sub-row inactive-mode" style={{ marginTop: 4 }}>
                <input type="checkbox" checked={false} onChange={() => toggle(idx)} />
                <div className="sub-name"><span className="dot" style={{ background: s.color }} />{s.name}</div>
              </div>
            )
          })}
        </>
      )}
    </div>
  )
}

// ── Zone priority ────────────────────────────────────────────────────────────

function ZoneList({ zonePriority, setZonePriority, zoneThresholds, setZoneThresholds }) {
  const dragIdx = useRef(null)

  function onDragStart(i) { dragIdx.current = i }
  function onDragOver(e, i) {
    e.preventDefault()
    if (dragIdx.current === null || dragIdx.current === i) return
    setZonePriority(prev => {
      const next = [...prev]
      const [item] = next.splice(dragIdx.current, 1)
      next.splice(i, 0, item)
      dragIdx.current = i
      return next
    })
  }
  function onDragEnd() { dragIdx.current = null }

  return (
    <div>
      {zonePriority.map((z, i) => {
        const mwp = (TOTAL_BY_ZONE[z] * MWP_PER_TABLE).toFixed(2)
        return (
          <div key={z} className="zone-row"
            draggable onDragStart={() => onDragStart(i)} onDragOver={e => onDragOver(e, i)} onDragEnd={onDragEnd}>
            <span className="grip">⠿</span>
            <span className="zn">#{i + 1}</span>
            <span style={{ flex: 1 }}>MVPS {z}</span>
            <span className="small" style={{ color: 'var(--muted)', marginRight: 4 }}>{mwp} MW</span>
            <input className="vre" type="number" min={1} max={100} value={zoneThresholds[z] ?? 100}
              onChange={e => setZoneThresholds(prev => ({ ...prev, [z]: +e.target.value }))}
              title="VRE threshold %" />
            <span className="small">%</span>
          </div>
        )
      })}
      <div className="small" style={{ marginTop: 4 }}>Drag to reorder · % = VRE test threshold</div>
    </div>
  )
}

// ── Workforce calendar ──────────────────────────────────────────────────────

function WorkforceCalendar({ inputMode, activeSubs, globalDeadline, generalCalOverrides, setGeneralCalOverrides, perSubCalOverrides, setPerSubCalOverrides, today }) {
  const days = []
  const end = new Date(globalDeadline)
  for (let d = new Date(today), i = 0; d <= end && i < 365; d.setDate(d.getDate() + 1), i++) {
    days.push(d.toISOString().slice(0, 10))
  }

  if (inputMode === 'general') {
    return (
      <div id="calWrap">
        <table className="cal">
          <thead><tr><th>Date</th><th>Workers (all crews)</th></tr></thead>
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

  // per-sub mode
  if (activeSubs.length === 0) return <div className="small muted">No active subcontractors.</div>
  return (
    <div id="calWrap">
      <table className="cal">
        <thead>
          <tr>
            <th>Date</th>
            {activeSubs.map(s => <th key={s.name} style={{ color: s.color }}>{s.name}</th>)}
          </tr>
        </thead>
        <tbody>
          {days.map(date => (
            <tr key={date}>
              <td>{date}</td>
              {activeSubs.map(s => {
                const key = `${s.name}|${date}`
                return (
                  <td key={s.name}>
                    <input type="number" min={0}
                      value={perSubCalOverrides[key] !== undefined ? perSubCalOverrides[key] : ''}
                      placeholder={s.workers}
                      onChange={e => setPerSubCalOverrides(prev => {
                        const next = { ...prev }
                        if (e.target.value === '') delete next[key]
                        else next[key] = +e.target.value
                        return next
                      })} />
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ── Main left panel ──────────────────────────────────────────────────────────

export default function LeftPanel({
  inputMode, setInputMode,
  generalWorkers, setGeneralWorkers, generalRate, setGeneralRate,
  subsConfig, setSubsConfig,
  zonePriority, setZonePriority, zoneThresholds, setZoneThresholds,
  globalDeadline, setGlobalDeadline, targetPct, setTargetPct,
  generalCalOverrides, setGeneralCalOverrides,
  perSubCalOverrides, setPerSubCalOverrides,
  activeSubs, onRun, simReady, simDays, today,
}) {
  const tPct = Math.max(1, Math.min(100, targetPct))
  const targetTables = Math.round(TOTAL_TABLES * tPct / 100)
  const targetMwp    = (targetTables * TOTAL_MWP / TOTAL_TABLES).toFixed(2)

  function handleModeChange(mode) {
    if (mode === 'perSub') {
      // Copy general values into each sub's fields when switching
      setSubsConfig(prev => prev.map(s => ({ ...s, workers: generalWorkers, prodMs: generalRate, prodPv: generalRate })))
    }
    setInputMode(mode)
  }

  return (
    <div className="col">
      <h1>San Pablo Solar</h1>
      <div className="small">Subcontractor allocation simulator</div>

      <Section title="Manpower & productivity">
        <ModeBar value={inputMode} onChange={handleModeChange} />
        {inputMode === 'general' ? (
          <div className="card">
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, fontSize: 11 }}>
              <div>
                <div className="small" style={{ marginBottom: 3 }}>Manpower (workers)</div>
                <input type="number" min={0} value={generalWorkers} onChange={e => setGeneralWorkers(+e.target.value)} />
              </div>
              <div>
                <div className="small" style={{ marginBottom: 3 }}>Rate (tables/person/day)</div>
                <input type="number" min={0} step={0.01} value={generalRate} onChange={e => setGeneralRate(+e.target.value)} />
              </div>
            </div>
            <div className="small" style={{ marginTop: 6 }}>Applied equally to all active subcontractors.</div>
            <div style={{ marginTop: 10 }}>
              <div className="small" style={{ marginBottom: 4, color: 'var(--muted)' }}>Active subcontractors</div>
              <SubsList subsConfig={subsConfig} setSubsConfig={setSubsConfig} inputMode="general" />
            </div>
          </div>
        ) : (
          <SubsList subsConfig={subsConfig} setSubsConfig={setSubsConfig} inputMode="perSub" />
        )}
      </Section>

      <Section title="MVPS priority & VRE threshold">
        <ZoneList zonePriority={zonePriority} setZonePriority={setZonePriority}
          zoneThresholds={zoneThresholds} setZoneThresholds={setZoneThresholds} />
      </Section>

      <Section title="Deadline & target">
        <div className="deadline-row">
          <div>Completion deadline</div>
          <input type="date" value={globalDeadline} onChange={e => setGlobalDeadline(e.target.value)} />
        </div>
        <div className="deadline-row">
          <div>Target % of park</div>
          <input type="number" min={1} max={100} value={targetPct} style={{ width: 60 }}
            onChange={e => setTargetPct(Math.max(1, Math.min(100, +e.target.value)))} />
        </div>
        <div className="small">{targetTables.toLocaleString()} tables · {targetMwp} MWp of {TOTAL_MWP} MWp</div>
      </Section>

      <Section title="Daily workforce calendar" defaultOpen={false}>
        <ModeBar value={inputMode} onChange={handleModeChange} />
        <div className="small" style={{ marginBottom: 6 }}>Leave blank to use base value.</div>
        <WorkforceCalendar
          inputMode={inputMode} activeSubs={activeSubs}
          globalDeadline={globalDeadline}
          generalCalOverrides={generalCalOverrides} setGeneralCalOverrides={setGeneralCalOverrides}
          perSubCalOverrides={perSubCalOverrides} setPerSubCalOverrides={setPerSubCalOverrides}
          today={today}
        />
      </Section>

      <button className="run" onClick={onRun}>▶ Run simulation</button>
      {simReady && <div className="small" style={{ marginTop: 6, textAlign: 'center' }}>{simDays} days computed.</div>}
    </div>
  )
}
