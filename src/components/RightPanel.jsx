import { ZONES, TABLES_BY_ZONE, TOTAL_TABLES, TOTAL_MWP } from '../data.js'

function Pill({ status }) {
  if (status === 'ok')  return <span className="pill ok">On time</span>
  if (status === 'bad') return <span className="pill bad">Late</span>
  return <span className="pill warn">?</span>
}

function Section({ title, children, defaultOpen = true }) {
  return (
    <div>
      <div className="sec-head open"><span>{title}</span><span className="arrow">▸</span></div>
      {children}
    </div>
  )
}

export default function RightPanel({ sim, stats, snap, fmt, subsConfig, globalDeadline, targetPct }) {
  function subColor(name) {
    const s = subsConfig.find(s => s.name === name)
    return s ? s.color : '#666'
  }

  return (
    <div className="col">
      <Section title="Global status">
        {!stats ? (
          <div className="small muted" style={{ padding: '8px 0' }}>Run simulation to see stats.</div>
        ) : (
          <div className="card">
            <div className="stat"><div>PV tables completed</div><div>{Math.round(stats.pvDoneCount)} / {TOTAL_TABLES}</div></div>
            <div className="stat"><div>Capacity completed</div><div>{stats.completedMwp.toFixed(2)} / {TOTAL_MWP.toFixed(2)} MWp</div></div>
            <div className="stat"><div>MS remaining (total)</div><div>{stats.totalMs.toFixed(1)}</div></div>
            <div className="stat"><div>PV remaining (total)</div><div>{stats.totalPv.toFixed(1)}</div></div>
            <div className="stat"><div>Projected 100% completion</div><div>{fmt(stats.globalCompletionDay)}</div></div>
            <div className="stat"><div>Vs. deadline</div><div><Pill status={stats.globalStatus} /></div></div>
            <div className="stat"><div>Target {stats.tPct}% ({stats.targetTables.toLocaleString()} tables)</div><div>{fmt(stats.targetDay)}</div></div>
            <div className="stat"><div>Target vs. deadline</div><div><Pill status={stats.targetStatus} /></div></div>
          </div>
        )}
      </Section>

      <Section title="Status by MVPS">
        {!sim || !snap ? (
          <div className="small muted" style={{ padding: '8px 0' }}>Run simulation to see zone stats.</div>
        ) : (
          ZONES.map(z => {
            const r = snap.remaining[z]
            const total = TABLES_BY_ZONE[z].length
            const done = total - r.ms - r.pvA - r.pvB
            const compDay = sim.zoneCompletionDay[z]
            const satDay  = sim.zoneSatisfiedDay[z]
            const working = (snap.assignment[z] || [])
            return (
              <div className="card" key={z}>
                <div style={{ fontWeight: 600, marginBottom: 4 }}>MVPS {z}</div>
                <div className="stat"><div>Completed</div><div>{done.toFixed(1)} / {total}</div></div>
                <div className="stat"><div>MS remaining</div><div>{r.ms.toFixed(1)}</div></div>
                <div className="stat"><div>PV remaining (existing MS)</div><div>{r.pvA.toFixed(1)}</div></div>
                <div className="stat"><div>PV remaining (new installs)</div><div>{r.pvB.toFixed(1)}</div></div>
                <div className="stat"><div>VRE test ready</div><div>{satDay !== undefined ? fmt(satDay) : '—'}</div></div>
                <div className="stat"><div>Fully completed</div><div>{compDay !== undefined ? fmt(compDay) : '—'}</div></div>
                <div style={{ marginTop: 4 }}>
                  {working.length > 0
                    ? working.map(name => (
                      <span className="working-chip" key={name}>
                        <span className="dot" style={{ background: subColor(name) }} />{name}
                      </span>
                    ))
                    : <span className="small">No manpower assigned</span>
                  }
                </div>
              </div>
            )
          })
        )}
      </Section>
    </div>
  )
}
