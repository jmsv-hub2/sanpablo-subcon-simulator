import { ZONES, TABLES_BY_ZONE, TOTAL_TABLES, TOTAL_MWP, TOTAL_BY_ZONE } from '../data.js'

const MWP_PER_TABLE = TOTAL_MWP / TOTAL_TABLES

function Pill({ status }) {
  if (status === 'ok')  return <span className="pill ok">On time</span>
  if (status === 'bad') return <span className="pill bad">Late</span>
  return <span className="pill warn">?</span>
}

// ── Zone matrix: fixed 3×3 grid, moving highlight ────────────────────────────

function ZoneMatrix({ snap, sim, zonePriority, zoneThresholds, dayIdx, fmt }) {
  const rows = [[1, 2, 3], [4, 5, 6], [7, 8, 9]]

  const priorityRank = {}
  zonePriority.forEach((z, i) => { priorityRank[z] = i + 1 })

  const activeZones = snap
    ? Object.entries(snap.assignment).filter(([, subs]) => subs.length > 0).map(([z]) => +z)
    : []

  return (
    <div className="zone-matrix">
      {rows.map(row => (
        <div key={row[0]} className="zone-matrix-row">
          {row.map(z => {
            const r = snap?.remaining[z]
            const total = TOTAL_BY_ZONE[z]
            const done = r ? total - r.ms - r.pvA - r.pvB - (r.pvPending || 0) : 0
            const pct = total > 0 ? (done / total) * 100 : 0
            const thresh = zoneThresholds[z] ?? 100
            const satDay  = sim?.zoneSatisfiedDay[z]
            const compDay = sim?.zoneCompletionDay[z]
            const isCurrent   = activeZones.includes(z)
            const isSatisfied = satDay  !== undefined && dayIdx !== undefined && satDay  <= dayIdx
            const isDone      = compDay !== undefined && dayIdx !== undefined && compDay <= dayIdx
            const doneMwp = (done * MWP_PER_TABLE).toFixed(1)
            const totalMwp = (total * MWP_PER_TABLE).toFixed(1)

            let cls = 'zone-cell'
            if (isDone)         cls += ' zone-cell-done'
            else if (isSatisfied) cls += ' zone-cell-sat'
            else if (isCurrent)   cls += ' zone-cell-active'

            return (
              <div key={z} className={cls}>
                <div className="zc-head">
                  <span className="zc-name">MVPS {z}</span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    {isSatisfied && <span className="zc-done-badge">✓ VRE</span>}
                    <span className="zc-rank">#{priorityRank[z]}</span>
                  </div>
                </div>
                <div className="zc-bar">
                  <div className="zc-bar-fill" style={{ width: `${Math.min(100, pct).toFixed(1)}%` }} />
                  <div className="zc-bar-thresh" style={{ left: `${thresh}%` }} />
                </div>
                <div className="zc-pct">{pct.toFixed(0)}% · {doneMwp}/{totalMwp} MW</div>
                {r && (
                  <div className="zc-stats">
                    <span>MS {r.ms.toFixed(0)}</span>
                    <span>PV {(r.pvA + r.pvB + (r.pvPending || 0)).toFixed(0)}</span>
                    {satDay !== undefined && <span style={{ color: 'var(--ok)' }}>✓ {fmt(satDay)}</span>}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      ))}
    </div>
  )
}

// ── Main component ───────────────────────────────────────────────────────────

export default function BottomStats({ sim, stats, snap, fmt, zonePriority, zoneThresholds, dayIdx, dailyThroughput, dailyWorkers }) {
  return (
    <div className="bottom-stats">
      {/* ── Global stats strip ──────────────────────────────────────────────── */}
      <div className="global-strip">
        {!stats ? (
          <span className="small muted">Run simulation to see stats.</span>
        ) : (
          <>
            <div className="gstat"><div className="gstat-val">{Math.round(stats.pvDoneCount).toLocaleString()} <span className="small">/ {TOTAL_TABLES.toLocaleString()}</span></div><div className="gstat-lbl">PV tables</div></div>
            <div className="gstat-div" />
            <div className="gstat"><div className="gstat-val">{stats.completedMwp.toFixed(1)} <span className="small">/ {TOTAL_MWP} MWp</span></div><div className="gstat-lbl">Capacity</div></div>
            <div className="gstat-div" />
            <div className="gstat"><div className="gstat-val">{dailyWorkers ?? '—'}</div><div className="gstat-lbl">Workers</div></div>
            <div className="gstat-div" />
            <div className="gstat"><div className="gstat-val">{dailyThroughput?.total.toFixed(0) ?? '—'}</div><div className="gstat-lbl">Tables/day</div></div>
            <div className="gstat-div" />
            <div className="gstat"><div className="gstat-val">{dailyThroughput?.ms.toFixed(0) ?? '—'}</div><div className="gstat-lbl">MS/day</div></div>
            <div className="gstat-div" />
            <div className="gstat"><div className="gstat-val">{dailyThroughput?.pv.toFixed(0) ?? '—'}</div><div className="gstat-lbl">PV/day</div></div>
            <div className="gstat-div" />
            <div className="gstat"><div className="gstat-val">{stats.totalMs.toFixed(0)}</div><div className="gstat-lbl">MS remaining</div></div>
            <div className="gstat-div" />
            <div className="gstat"><div className="gstat-val">{stats.totalPv.toFixed(0)}</div><div className="gstat-lbl">PV remaining</div></div>
            <div className="gstat-div" />
            <div className="gstat"><div className="gstat-val">{fmt(stats.targetDay)}</div><div className="gstat-lbl">Target {stats.tPct}%</div></div>
          </>
        )}
      </div>

      {/* ── Zone matrix ─────────────────────────────────────────────────────── */}
      {sim && snap && (
        <ZoneMatrix
          snap={snap} sim={sim}
          zonePriority={zonePriority} zoneThresholds={zoneThresholds}
          dayIdx={dayIdx} fmt={fmt}
        />
      )}
    </div>
  )
}
