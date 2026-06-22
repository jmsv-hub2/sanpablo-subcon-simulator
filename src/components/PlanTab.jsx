import { useState, useCallback } from 'react'
import ExcelJS from 'exceljs'

function fmtDisplayDate(iso) {
  const [y, m, d] = iso.split('-')
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  return `${d} ${months[+m - 1]} ${y}`
}

const DOW = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat']
const CENTER = { horizontal: 'center', vertical: 'middle' }
const LEFT   = { horizontal: 'left',   vertical: 'middle' }

function addSheet(wb, name, colDefs, rows, idColIndices = []) {
  const ws = wb.addWorksheet(name)
  ws.columns = colDefs.map(c => ({ header: c.label, width: c.width }))
  ws.getRow(1).eachCell(cell => { cell.alignment = CENTER; cell.font = { bold: true } })
  rows.forEach(rowData => {
    const row = ws.addRow(rowData)
    row.eachCell({ includeEmpty: true }, (cell, colNum) => {
      cell.alignment = idColIndices.includes(colNum - 1) ? LEFT : CENTER
    })
  })
}

async function exportXlsx(planData, zones) {
  const wb = new ExcelJS.Workbook()

  // ── Sheet 1: Daily summary ─────────────────────────────────────
  addSheet(wb, 'Daily Summary', [
    { label: 'Day',           width: 6  },
    { label: 'Date',          width: 12 },
    { label: 'Weekday',       width: 9  },
    { label: 'Total workers', width: 13 },
    { label: 'MS workers',    width: 11 },
    { label: 'PV workers',    width: 11 },
    { label: 'MS tables',     width: 10 },
    { label: 'PV tables',     width: 10 },
    { label: 'MS Table IDs',  width: 80 },
    { label: 'PV Table IDs',  width: 80 },
  ], planData.map(d => {
    const msIds = zones.flatMap(z => d.msToday[z])
    const pvIds = zones.flatMap(z => d.pvToday[z])
    return [d.day, d.dateStr, DOW[new Date(d.dateStr).getDay()],
      d.workers, d.msWorkers, d.pvWorkers, d.msCount, d.pvCount,
      msIds.join(', '), pvIds.join(', ')]
  }), [8, 9])

  // ── Sheet 2: MS plan ──────────────────────────────────────────
  const planCols = [
    { label: 'Day',          width: 6  },
    { label: 'Date',         width: 12 },
    { label: 'Weekday',      width: 9  },
    { label: 'MVPS zone',    width: 10 },
    { label: 'Tables count', width: 13 },
    { label: 'Table IDs',    width: 80 },
  ]
  const msRows = []
  planData.forEach(d => zones.forEach(z => {
    const ids = d.msToday[z]
    if (ids.length) msRows.push([d.day, d.dateStr, DOW[new Date(d.dateStr).getDay()], `MVPS ${z}`, ids.length, ids.join(', ')])
  }))
  addSheet(wb, 'MS Plan', planCols, msRows, [5])

  // ── Sheet 3: PV plan ──────────────────────────────────────────
  const pvRows = []
  planData.forEach(d => zones.forEach(z => {
    const ids = d.pvToday[z]
    if (ids.length) pvRows.push([d.day, d.dateStr, DOW[new Date(d.dateStr).getDay()], `MVPS ${z}`, ids.length, ids.join(', ')])
  }))
  addSheet(wb, 'PV Plan', planCols, pvRows, [5])

  // ── Sheet 4: Per-table schedule ───────────────────────────────
  const tableMap = {}
  planData.forEach(d => zones.forEach(z => {
    d.msToday[z].forEach(id => {
      if (!tableMap[id]) tableMap[id] = { id, zone: z, msDay: null, msDate: null, pvDay: null, pvDate: null }
      tableMap[id].msDay = d.day; tableMap[id].msDate = d.dateStr
    })
    d.pvToday[z].forEach(id => {
      if (!tableMap[id]) tableMap[id] = { id, zone: z, msDay: null, msDate: null, pvDay: null, pvDate: null }
      tableMap[id].pvDay = d.day; tableMap[id].pvDate = d.dateStr
    })
  }))
  const tableRows = Object.values(tableMap)
    .sort((a, b) => (a.zone - b.zone) || (a.msDay ?? 0) - (b.msDay ?? 0))
    .map(t => [t.id, `MVPS ${t.zone}`, t.msDay ?? '', t.msDate ?? '', t.pvDay ?? '', t.pvDate ?? ''])
  addSheet(wb, 'Per-Table Schedule', [
    { label: 'Table ID',  width: 10 },
    { label: 'MVPS zone', width: 10 },
    { label: 'MS day',    width: 7  },
    { label: 'MS date',   width: 12 },
    { label: 'PV day',    width: 7  },
    { label: 'PV date',   width: 12 },
  ], tableRows, [])

  // ── Download ──────────────────────────────────────────────────
  const buffer = await wb.xlsx.writeBuffer()
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `MSPV_Plan_${new Date().toISOString().slice(0, 10)}.xlsx`
  document.body.appendChild(a); a.click()
  document.body.removeChild(a); URL.revokeObjectURL(url)
}

function DayRow({ d, zones, defaultOpen }) {
  const [open, setOpen] = useState(defaultOpen ?? false)
  const hasWork = d.msCount > 0 || d.pvCount > 0
  const dow = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][new Date(d.dateStr).getDay()]
  const isSunday = dow === 'Sun'

  return (
    <div className={`plan-row${open ? ' plan-row-open' : ''}${isSunday ? ' plan-row-sun' : ''}`}>
      {/* Summary bar */}
      <div className="plan-row-head" onClick={() => hasWork && setOpen(o => !o)}>
        <span className="plan-day">Day {d.day}</span>
        <span className="plan-date">{dow} {fmtDisplayDate(d.dateStr)}</span>
        <div className="plan-workers">
          <span className="plan-workers-total">{d.workers}<span className="plan-workers-lbl"> workers</span></span>
          {d.msWorkers > 0 && <span className="plan-badge plan-badge-ms">{d.msWorkers} MS</span>}
          {d.pvWorkers > 0 && <span className="plan-badge plan-badge-pv">{d.pvWorkers} PV</span>}
        </div>
        <div className="plan-counts">
          {d.msCount > 0 && <span className="plan-badge plan-badge-ms">{d.msCount} MS</span>}
          {d.pvCount > 0 && <span className="plan-badge plan-badge-pv">{d.pvCount} PV</span>}
          {d.msCount === 0 && d.pvCount === 0 && <span className="plan-idle">—</span>}
        </div>
        {hasWork && <span className="plan-expand">{open ? '▾' : '▸'}</span>}
      </div>

      {/* Expanded detail */}
      {open && (
        <div className="plan-detail">
          {zones.map(z => {
            const ms = d.msToday[z] ?? []
            const pv = d.pvToday[z] ?? []
            if (ms.length === 0 && pv.length === 0) return null
            return (
              <div key={z} className="plan-zone-block">
                <div className="plan-zone-lbl">MVPS {z}</div>
                {ms.length > 0 && (
                  <div className="plan-ids-row">
                    <span className="plan-ids-tag plan-ids-ms">MS ×{ms.length}</span>
                    <span className="plan-ids">{ms.join(' · ')}</span>
                  </div>
                )}
                {pv.length > 0 && (
                  <div className="plan-ids-row">
                    <span className="plan-ids-tag plan-ids-pv">PV ×{pv.length}</span>
                    <span className="plan-ids">{pv.join(' · ')}</span>
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

export default function PlanTab({ planData, zones, today }) {
  const [filter, setFilter] = useState('')

  const filtered = planData
    ? planData.filter(d =>
        !filter ||
        d.dateStr.includes(filter) ||
        String(d.day).includes(filter) ||
        zones.some(z => d.msToday[z].some(id => String(id).includes(filter)) ||
                        d.pvToday[z].some(id => String(id).includes(filter)))
      )
    : []

  const totalMs = planData ? planData.reduce((s, d) => s + d.msCount, 0) : 0
  const totalPv = planData ? planData.reduce((s, d) => s + d.pvCount, 0) : 0

  const handleExport = useCallback(() => {
    if (planData) exportXlsx(planData, zones).catch(console.error)
  }, [planData, zones])

  if (!planData) {
    return (
      <div className="plan-empty">
        <div className="plan-empty-icon">▶</div>
        <div className="plan-empty-msg">Run simulation to generate the MSPV plan</div>
      </div>
    )
  }

  return (
    <div className="plan-wrap">
      {/* Header */}
      <div className="plan-header">
        <div className="plan-summary">
          <div className="plan-stat">
            <span className="plan-stat-val">{planData.length}</span>
            <span className="plan-stat-lbl">active days</span>
          </div>
          <div className="plan-stat-div" />
          <div className="plan-stat">
            <span className="plan-stat-val" style={{ color: 'var(--warn)' }}>{totalMs.toLocaleString()}</span>
            <span className="plan-stat-lbl">MS tables</span>
          </div>
          <div className="plan-stat-div" />
          <div className="plan-stat">
            <span className="plan-stat-val" style={{ color: 'var(--accent)' }}>{totalPv.toLocaleString()}</span>
            <span className="plan-stat-lbl">PV tables</span>
          </div>
          <div className="plan-stat-div" />
          <div className="plan-stat">
            <span className="plan-stat-val" style={{ color: 'var(--ok)' }}>{fmtDisplayDate(planData[planData.length - 1]?.dateStr ?? today)}</span>
            <span className="plan-stat-lbl">last day</span>
          </div>
        </div>
        <div className="plan-actions">
          <input
            className="plan-search"
            placeholder="Search day / date / table ID…"
            value={filter}
            onChange={e => setFilter(e.target.value)}
          />
          <button className="plan-export-btn" onClick={handleExport}>⬇ Export Excel</button>
        </div>
      </div>

      {/* Column headers */}
      <div className="plan-cols">
        <span style={{ width: 64 }}>Day</span>
        <span style={{ flex: 1 }}>Date</span>
        <span style={{ width: 160 }}>Workers</span>
        <span style={{ width: 100 }}>Tables done</span>
        <span style={{ width: 20 }} />
      </div>

      {/* Rows */}
      <div className="plan-list">
        {filtered.length === 0 && (
          <div className="plan-idle" style={{ padding: 24, textAlign: 'center' }}>No results</div>
        )}
        {filtered.map(d => (
          <DayRow key={d.day} d={d} zones={zones} />
        ))}
      </div>
    </div>
  )
}
