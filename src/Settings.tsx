import { useState } from 'react'
import { PROFILES } from './engine/rules.ts'
import { FORMAT_LABEL, type Format } from './engine/types.ts'
import { LANGS } from './engine/rules.ts'
import { deleteProject, getDefaults, getProjects, setDefaults, type Defaults } from './store.ts'
import { exportAll, useSync } from './sync.ts'
import { ask, download, setTheme, toast, useDark } from './ui.tsx'

export default function Settings() {
  const [d, setD] = useState<Defaults>(getDefaults)
  const dark = useDark()
  const sync = useSync()
  const save = (p: Partial<Defaults>) => { const next = { ...d, ...p }; setD(next); setDefaults(next); toast('Saved', { tone: 'ok', ttl: 1500 }) }

  return (
    <section className="page narrow settings">
      <div className="eyebrow">Settings</div>
      <h1>Settings</h1>

      <div className="panel">
        <h2>Defaults for new projects</h2>
        <div className="inline-fields">
          <label className="field"><span>Rule profile</span><select value={d.profileId} onChange={e => save({ profileId: e.target.value })}>{PROFILES.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
          <label className="field"><span>Usual source language</span><select value={d.sourceLang} onChange={e => save({ sourceLang: e.target.value })}>{Object.entries(LANGS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
          <label className="field"><span>Export format</span><select value={d.exportFormat} onChange={e => save({ exportFormat: e.target.value as Format | 'same' })}><option value="same">Same as imported</option>{(Object.keys(FORMAT_LABEL) as Format[]).map(f => <option key={f} value={f}>{FORMAT_LABEL[f]}</option>)}</select></label>
        </div>
        <label className="row gap-sm small"><span className="switch"><input type="checkbox" checked={d.kids} onChange={e => save({ kids: e.target.checked })} /><span /></span> Children&rsquo;s reading speeds by default</label>
      </div>

      <div className="panel">
        <h2>Appearance</h2>
        <div className="seg-control" role="radiogroup" aria-label="Theme">
          <button type="button" role="radio" aria-checked={!dark} className={!dark ? 'on' : ''} onClick={() => setTheme('light')}>Light</button>
          <button type="button" role="radio" aria-checked={dark} className={dark ? 'on' : ''} onClick={() => setTheme('dark')}>Dark</button>
        </div>
      </div>

      <div className="panel">
        <h2>Your data</h2>
        <p>Projects live in this browser (IndexedDB). Videos are never stored or uploaded. {sync.user ? <>Signed in as <b>{sync.user.email}</b>: projects and snapshots sync to your account.</> : 'Sign in from the account menu (top right) to sync across devices. It is optional.'}</p>
        <div className="row gap wrap">
          <button type="button" className="btn ghost" onClick={async () => download(`caption-qa-export-${new Date().toISOString().slice(0, 10)}.json`, await exportAll())}>Export all my data (JSON)</button>
          <button type="button" className="btn danger-ghost" onClick={async () => {
            const list = getProjects()
            if (!list.length) { toast('Nothing to delete'); return }
            if (!(await ask('Delete all local projects?', `Removes ${list.length} project${list.length > 1 ? 's' : ''} from this browser${sync.user ? ' and from your cloud account' : ''}. You can undo for a few seconds.`, 'Delete everything'))) return
            const undos = await Promise.all(list.map(p => deleteProject(p.id)))
            toast(`Deleted ${list.length} projects`, { undo: () => { for (const u of undos) void u() } })
          }}>Delete all projects</button>
        </div>
      </div>

      <div className="panel">
        <h2>Keyboard shortcuts</h2>
        <dl className="shortcuts">
          <div><dt><kbd>1</kbd>&ndash;<kbd>7</kbd></dt><dd>Switch project sections</dd></div>
          <div><dt><kbd>Space</kbd></dt><dd>Play / pause the video (Review)</dd></div>
          <div><dt><kbd>J</kbd> <kbd>K</kbd></dt><dd>Previous / next cue (Review)</dd></div>
          <div><dt><kbd>N</kbd></dt><dd>Next cue with an issue (Review)</dd></div>
          <div><dt><kbd>&#8984;</kbd>/<kbd>Ctrl</kbd> <kbd>Enter</kbd></dt><dd>Save the cue being edited</dd></div>
          <div><dt><kbd>S</kbd></dt><dd>Save a snapshot</dd></div>
          <div><dt><kbd>P</kbd></dt><dd>Printable QC report</dd></div>
          <div><dt><kbd>&#8984;</kbd>/<kbd>Ctrl</kbd> <kbd>Z</kbd></dt><dd>Undo the last change from a toast</dd></div>
        </dl>
      </div>
    </section>
  )
}
