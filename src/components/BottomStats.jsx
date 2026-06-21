import { ZONES, TABLES_BY_ZONE, TOTAL_TABLES, TOTAL_MWP, TOTAL_BY_ZONE } from '../data.js'

const MWP_PER_TABLE = TOTAL_MWP / TOTAL_TABLES

function Pill({ status }) {
  if (status === 'ok')  return <span className="pill ok">On time</span>
  if (status === 'bad') return <span className="pill bad">Late</span>
  return <span className="pill warn">?</span>
}

export default function BottomStats({ sim, stats, snap, fmt, subsConfig }) {
  function subColor(name) {
    const s = subsConfig.find(s => s.name === name)
    return s ? s.color : '#666'
  }

  return (
    <div className="bottom-stats">
      {/* ── Global row ─────────────────────────────────────────── */}
      <div className="global-strip">
        {!stats ? (
          <span className="small muted">Run simulation to see stats.</span>
        ) : (
          <>
            <div className="gstat"><div className="gstat-val">{Math.round(stats.pvDoneCount).toLocaleString()} <span className="small">/ {TOTAL_TABLES.toLocaleString()}</span></div><div className="gstat-lbl">PV tables</div></div>
            <div className="gstat-div" />
            <div className="gstat"><div className="gstat-val">{stats.completedMwp.toFixed(1)} <span className="small">/ {TOTAL_MWP} MWp</span></div><div className="gstat-lbl">Capacity</div></div>
            <div className="gstat-div" />
            <div className="gstat"><div className="gstat-val">{stats.totalMs.toFixed(0)}</div><div className="gstat-lbl">MS remaining</div></div>
            <div className="gstat-div" />
            <div className="gstat"><div className="gstat-val">{stats.totalPv.toFixed(0)}</div><div className="gstat-lbl">PV remaining</div></div>
            <div className="gstat-div" />
            <div className="gstat"><div className="gstat-val">{fmt(stats.globalCompletionDay)}</div><div className="gstat-lbl">100% done <Pill status={stats.globalStatus} /></div></div>
            <div className="gstat-div" />
            <div className="gstat"><div className="gstat-val">{fmt(stats.targetDay)}</div><div className="gstat-lbl">Target {stats.tPct}% <Pill status={stats.targetStatus} /></div></div>
          </>
        )}
      </div>

      {/* ── Zone cards row ─────────────────────────────────────── */}
      {sim && snap && (
        <div className="zone-strip">
          {ZONES.map(z => {
            const r = snap.remaining[z]
            const total = TABLES_BY_ZONE[z].length
            const done = total - r.ms - r.pvA - r.pvB
            const pct = ((done / total) * 100).toFixed(0)
            const mwp = (TOTAL_BY_ZONE[z] * MWP_PER_TABLE).toFixed(1)
            const compDay = sim.zoneCompletionDay[z]
            const satDay  = sim.zoneSatisfiedDay[z]
            const working = snap.assignment[z] || []
            return (
              <div className="zone-card" key={z}>
                <div className="zone-card-head">
                  <span style={{ fontWeight: 600 }}>MVPS {z}</span>
                  <span className="small muted">{mwp} MW</span>
                </div>
                <div className="zone-card-bar">
                  <div className="zone-card-bar-fill" style={{ width: `${pct}%` }} />
                </div>
                <div className="zone-card-pct">{pct}% · {done.toFixed(0)}/{total}</div>
                <div className="zone-card-row"><span className="muted">MS rem.</span><span>{r.ms.toFixed(0)}</span></div>
                <div className="zone-card-row"><span className="muted">PV rem. A/B</span><span>{r.pvA.toFixed(0)}/{r.pvB.toFixed(0)}</span></div>
                <div className="zone-card-row"><span className="muted">VRE ready</span><span>{satDay !== undefined ? fmt(satDay) : '—'}</span></div>
                <div className="zone-card-row"><span className="muted">Done</span><span>{compDay !== undefined ? fmt(compDay) : '—'}</span></div>
                {working.length > 0 && (
                  <div style={{ marginTop: 4, display: 'flex', flexWrap: 'wrap', gap: 2 }}>
                    {working.map(name => (
                      <span key={name} className="working-chip">
                        <span className="dot" style={{ background: subColor(name) }} />{name}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
