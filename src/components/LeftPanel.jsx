import { useState, useRef } from 'react'
import { ZONES, TOTAL_TABLES, TOTAL_MWP } from '../data.js'

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

// ── Subcontractors ──────────────────────────────────────────────────────────

function SubsList({ subsConfig, setSubsConfig, prodMode }) {
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
      {/* header */}
      <div className={`sub-row${prodMode === 'common' ? ' common-mode' : ''}`} style={{ fontWeight: 600, color: 'var(--muted)', fontSize: 11 }}>
        <div /><div>Sub</div><div>Manpower</div>
        {prodMode === 'perSub' && <><div>MS r.</div><div>PV r.</div></>}
        <div title="PV only">PV only</div>
      </div>

      {active.map((s, _) => {
        const idx = subsConfig.indexOf(s)
        return (
          <div key={s.name} className={`sub-row${prodMode === 'common' ? ' common-mode' : ''}`}>
            <input type="checkbox" checked onChange={() => toggle(idx)} />
            <div className="sub-name"><span className="dot" style={{ background: s.color }} />{s.name}</div>
            <input type="number" min={0} value={s.workers} onChange={e => update(idx, 'workers', +e.target.value)} />
            {prodMode === 'perSub' && <>
              <input type="number" min={0} step={0.01} value={s.prodMs} onChange={e => update(idx, 'prodMs', +e.target.value)} />
              <input type="number" min={0} step={0.01} value={s.prodPv} onChange={e => update(idx, 'prodPv', +e.target.value)} />
            </>}
            <div className="pvonly">
              <input type="checkbox" checked={s.pvOnly} onChange={e => update(idx, 'pvOnly', e.target.checked)}
                title="Only installs PV on tables that already have MS done" />
            </div>
          </div>
        )
      })}

      {inactive.length > 0 && (
        <>
          <div className={`collapsible-head${showInactive ? ' open' : ''}`} onClick={() => setShowInactive(o => !o)}>
            <span className="arrow">▸</span> Inactive subcontractors ({inactive.length})
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

// ── Zone priority (drag-and-drop) ───────────────────────────────────────────

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
      {zonePriority.map((z, i) => (
        <div key={z} className="zone-row"
          draggable onDragStart={() => onDragStart(i)} onDragOver={e => onDragOver(e, i)} onDragEnd={onDragEnd}>
          <span className="grip">⠿</span>
          <span className="zn">#{i + 1}</span>
          <span style={{ flex: 1 }}>MVPS {z}</span>
          <input className="vre" type="number" min={1} max={100} value={zoneThresholds[z] ?? 100}
            onChange={e => setZoneThresholds(prev => ({ ...prev, [z]: +e.target.value }))}
            title="VRE threshold %" />
          <span className="small">%</span>
        </div>
      ))}
      <div className="small" style={{ marginTop: 4 }}>Drag to reorder · % = VRE test threshold</div>
    </div>
  )
}

// ── Workforce calendar ──────────────────────────────────────────────────────

function WorkforceCalendar({ activeSubs, globalDeadline, workforceOverrides, setWorkforceOverrides, today }) {
  const days = []
  const start = new Date(today)
  const end   = new Date(globalDeadline)
  const MAX = 365
  for (let d = new Date(start), i = 0; d <= end && i < MAX; d.setDate(d.getDate() + 1), i++) {
    days.push(d.toISOString().slice(0, 10))
  }

  function setOverride(subName, dateStr, val) {
    const key = `${subName}|${dateStr}`
    setWorkforceOverrides(prev => {
      const next = { ...prev }
      if (val === '' || val === null) { delete next[key] } else { next[key] = +val }
      return next
    })
  }

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
          {days.map(dateStr => (
            <tr key={dateStr}>
              <td>{dateStr}</td>
              {activeSubs.map(s => {
                const key = `${s.name}|${dateStr}`
                const val = workforceOverrides[key]
                return (
                  <td key={s.name}>
                    <input type="number" min={0} placeholder={s.workers}
                      value={val !== undefined ? val : ''}
                      onChange={e => setOverride(s.name, dateStr, e.target.value === '' ? null : e.target.value)} />
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

// ── Main left panel ─────────────────────────────────────────────────────────

export default function LeftPanel({
  prodMode, setProdMode, commonMs, setCommonMs, commonPv, setCommonPv,
  subsConfig, setSubsConfig,
  zonePriority, setZonePriority, zoneThresholds, setZoneThresholds,
  globalDeadline, setGlobalDeadline, targetPct, setTargetPct,
  workforceOverrides, setWorkforceOverrides,
  activeSubs, onRun, simReady, simDays, today,
}) {
  const tPct = Math.max(1, Math.min(100, targetPct))
  const targetTables = Math.round(TOTAL_TABLES * tPct / 100)
  const targetMwp    = (targetTables * TOTAL_MWP / TOTAL_TABLES).toFixed(2)

  function handleProdModeChange(mode) {
    if (mode === 'perSub') {
      setSubsConfig(prev => prev.map(s => ({ ...s, prodMs: commonMs, prodPv: commonPv })))
    }
    setProdMode(mode)
  }

  return (
    <div className="col">
      <h1>San Pablo Solar</h1>
      <div className="small">Subcontractor allocation simulator — MS → PV pipeline</div>

      <Section title="Productivity mode">
        <div className="modebar">
          <label><input type="radio" name="prodMode" value="common" checked={prodMode === 'common'} onChange={() => handleProdModeChange('common')} /> Common rate</label>
          <label><input type="radio" name="prodMode" value="perSub" checked={prodMode === 'perSub'} onChange={() => handleProdModeChange('perSub')} /> Per subcontractor</label>
        </div>
        {prodMode === 'common' && (
          <div className="card">
            <div className="sub-row common-mode" style={{ fontWeight: 600, color: 'var(--muted)', fontSize: 11 }}>
              <div /><div>Rate (tables/person/day)</div><div />
            </div>
            <div className="sub-row common-mode">
              <div />
              <div style={{ display: 'flex', gap: 8 }}>
                <input type="number" min={0} step={0.01} value={commonMs} onChange={e => setCommonMs(+e.target.value)} title="MS rate" />
                <input type="number" min={0} step={0.01} value={commonPv} onChange={e => setCommonPv(+e.target.value)} title="PV rate" />
              </div>
              <div />
            </div>
            <div className="small">Left: MS rate · Right: PV rate — applies to all active subs.</div>
          </div>
        )}
      </Section>

      <Section title="Active subcontractors">
        <SubsList subsConfig={subsConfig} setSubsConfig={setSubsConfig} prodMode={prodMode} />
      </Section>

      <Section title="MVPS priority & VRE test threshold">
        <ZoneList zonePriority={zonePriority} setZonePriority={setZonePriority}
          zoneThresholds={zoneThresholds} setZoneThresholds={setZoneThresholds} />
      </Section>

      <Section title="Deadline & target">
        <div className="deadline-row">
          <div>Project completion deadline</div>
          <input type="date" value={globalDeadline} onChange={e => setGlobalDeadline(e.target.value)} />
        </div>
        <div className="deadline-row">
          <div>Target % of park to complete</div>
          <input type="number" min={1} max={100} value={targetPct} style={{ width: 60 }}
            onChange={e => setTargetPct(Math.max(1, Math.min(100, +e.target.value)))} />
        </div>
        <div className="small" style={{ marginTop: 2 }}>
          {targetTables.toLocaleString()} tables · {targetMwp} MWp out of {TOTAL_TABLES.toLocaleString()} / {TOTAL_MWP} MWp
        </div>
      </Section>

      <Section title="Daily workforce calendar" defaultOpen={false}>
        <div className="small" style={{ marginBottom: 6 }}>
          Override worker counts per sub per day. Leave blank to use the base value.
        </div>
        <WorkforceCalendar activeSubs={activeSubs} globalDeadline={globalDeadline}
          workforceOverrides={workforceOverrides} setWorkforceOverrides={setWorkforceOverrides} today={today} />
      </Section>

      <button className="run" onClick={onRun}>▶ Run simulation</button>
      {simReady && <div className="small" style={{ marginTop: 6, textAlign: 'center' }}>Simulation ready: {simDays} days computed.</div>}
    </div>
  )
}
