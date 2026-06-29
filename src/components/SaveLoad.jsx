import { useRef } from 'react'

// ── Save / Open simulation parameters (client-side only — never touches the Sheet) ──
export default function SaveLoad({ getConfig, applyConfig }) {
  const fileRef = useRef(null)

  const handleSave = () => {
    const cfg = getConfig()
    const blob = new Blob([JSON.stringify(cfg, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `mspv-sim-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  const handleOpen = e => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      try { applyConfig(JSON.parse(reader.result)) }
      catch { alert('Invalid file — could not read simulation parameters.') }
    }
    reader.readAsText(file)
    e.target.value = '' // allow re-importing the same file
  }

  return (
    <div className="saveload">
      <button className="sl-btn" onClick={handleSave} title="Save current parameters to a file">💾 Save</button>
      <button className="sl-btn" onClick={() => fileRef.current?.click()} title="Load parameters from a file">📂 Open</button>
      <input ref={fileRef} type="file" accept="application/json,.json" style={{ display: 'none' }} onChange={handleOpen} />
    </div>
  )
}
