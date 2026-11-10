import { useRef, useState } from 'react'
import { parseShotList } from './engine/parse.ts'
import { LANGS, PROFILES, rulesFor, type Rules } from './engine/rules.ts'
import { FORMAT_LABEL } from './engine/types.ts'
import { ParseReport } from './Project.tsx'
import { getProfile, readSubtitleFile, sourceOf, trackFrom, updateTracks, type PendingFile } from './projectData.ts'
import { saveProject, type Project } from './store.ts'
import { ask, fmtN, toast } from './ui.tsx'

const FIELDS: { k: keyof Rules; label: string; step?: number; min?: number; hint?: string }[] = [
  { k: 'maxCps', label: 'Max characters / second', step: 0.5, min: 0, hint: '0 turns the check off' },
  { k: 'maxWpm', label: 'Max words / minute', step: 5, min: 0, hint: '0 turns the check off' },
  { k: 'maxChars', label: 'Max characters / line', min: 5 },
  { k: 'maxLines', label: 'Max lines', min: 1 },
  { k: 'minDurationMs', label: 'Min duration (ms)', step: 10, min: 0 },
  { k: 'maxDurationMs', label: 'Max duration (ms)', step: 100, min: 500 },
  { k: 'minMsPerWord', label: 'Min ms per word', step: 10, min: 0, hint: '0 turns the check off' },
  { k: 'fps', label: 'Frame rate', step: 0.001, min: 1 },
  { k: 'minGapFrames', label: 'Min gap (frames)', min: 0 },
  { k: 'closeGapFrames', label: 'Close gaps under (frames)', min: 0, hint: '0 turns the check off' },
  { k: 'shotChangeFrames', label: 'Shot-change window (frames)', min: 0, hint: '0 turns the check off' },
]

export default function Setup({ p }: { p: Project }) {
  return (
    <div className="stack">
      <Tracks p={p} />
      <div className="grid-2">
        <Profile p={p} />
        <Shots p={p} />
      </div>
    </div>
  )
}

function Tracks({ p }: { p: Project }) {
  const [pending, setPending] = useState<PendingFile[]>([])
  const [drag, setDrag] = useState(false)
  const [reading, setReading] = useState(false)
  const input = useRef<HTMLInputElement>(null)

  const read = async (files: FileList | File[]) => {
    setReading(true)
    const out: PendingFile[] = []
    let hasSource = !!sourceOf(p) || pending.some(x => x.role === 'source')
    for (const f of [...files]) {
      if (f.size > 20e6) { toast(`${f.name} is over 20 MB; that is not a subtitle file.`, { tone: 'error' }); continue }
      try {
        const r = await readSubtitleFile(f, hasSource)
        if (r.role === 'source') hasSource = true
        out.push(r)
      } catch (e) { toast(`Could not read ${f.name}: ${e instanceof Error ? e.message : e}`, { tone: 'error' }) }
    }
    setPending(x => [...x, ...out])
    setReading(false)
  }

  const add = async () => {
    const ok = pending.filter(x => x.result.cues.length)
    if (!ok.length) return
    let tracks = [...p.tracks]
    if (ok.some(x => x.role === 'source')) tracks = tracks.map(t => t.role === 'source' ? { ...t, role: 'target' as const } : t)
    tracks.push(...ok.map(x => trackFrom(x.result, x.fileName, x.lang, x.role)))
    await updateTracks(p, tracks, `Import ${ok.length} file${ok.length > 1 ? 's' : ''}`)
    setPending([])
    toast(`Added ${ok.length} track${ok.length > 1 ? 's' : ''}`, { tone: 'ok' })
  }

  const setP = (key: string, patch: Partial<PendingFile>) => setPending(x => x.map(f => f.key === key ? { ...f, ...patch } : patch.role === 'source' ? { ...f, role: 'target' } : f))

  return (
    <div className="panel">
      <div className="panel-head"><h2>Tracks</h2><span className="muted small">One source, any number of targets. Targets are aligned to the source by time.</span></div>
      {p.tracks.length > 0 && (
        <div className="table-wrap">
          <table>
            <thead><tr><th>File</th><th>Language</th><th>Role</th><th>Format</th><th className="num">Cues</th><th /></tr></thead>
            <tbody>
              {p.tracks.map(t => (
                <tr key={t.id}>
                  <th className="break">{t.fileName}<div className="muted tiny">{t.encoding ?? 'UTF-8'}{t.parseIssues.length ? ` · ${t.parseIssues.length} import findings` : ''}</div></th>
                  <td><LangSelect value={t.lang} onChange={lang => void updateTracks(p, p.tracks.map(x => x.id === t.id ? { ...x, lang } : x), 'Change language')} /></td>
                  <td>
                    <select aria-label="Role" value={t.role} onChange={e => void updateTracks(p, p.tracks.map(x => x.id === t.id ? { ...x, role: e.target.value as 'source' } : e.target.value === 'source' && x.role === 'source' ? { ...x, role: 'target' as const } : x), 'Change role')}>
                      <option value="source">Source</option><option value="target">Target</option>
                    </select>
                  </td>
                  <td className="small">{FORMAT_LABEL[t.format]}</td>
                  <td className="num">{t.cues.length}</td>
                  <td className="row end"><button type="button" className="btn danger-ghost sm" onClick={async () => {
                    if (!(await ask(`Remove ${t.fileName}?`, 'Removes this track and its edits from the project. You can undo it.', 'Remove'))) return
                    await updateTracks(p, p.tracks.filter(x => x.id !== t.id), `Remove ${t.fileName}`)
                    toast(`Removed ${t.fileName}`)
                  }}>Remove</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className={`dropzone${drag ? ' on' : ''}`} onDragOver={e => { e.preventDefault(); setDrag(true) }} onDragLeave={() => setDrag(false)}
        onDrop={e => { e.preventDefault(); setDrag(false); void read(e.dataTransfer.files) }}>
        <input ref={input} type="file" multiple accept=".srt,.vtt,.ass,.ssa,.ttml,.dfxp,.xml,.sbv,.txt" hidden onChange={e => { if (e.target.files) void read(e.target.files); e.target.value = '' }} />
        <div className="dz-icon" aria-hidden="true" />
        <p><b>Drop subtitle files here</b> or <button type="button" className="linkish" onClick={() => input.current?.click()}>choose files</button></p>
        <p className="muted small">SRT, WebVTT, ASS/SSA, TTML/DFXP, SBV · UTF-8, UTF-16 or Windows-1252 · several at once is fine</p>
        {reading && <p className="small"><span className="spinner inline" /> Reading</p>}
      </div>

      {pending.length > 0 && (
        <div className="pending">
          <h3>Check before adding</h3>
          {pending.map(f => {
            const errs = f.result.issues.filter(i => i.severity === 'error').length
            return (
              <div key={f.key} className="pending-file">
                <div className="row between wrap gap">
                  <div>
                    <b className="break">{f.fileName}</b>
                    <div className="muted small">{FORMAT_LABEL[f.result.format]} · {f.result.encoding} · {fmtN(f.result.cues.length)} cues · {(f.size / 1024).toFixed(1)} KB</div>
                  </div>
                  <div className="row gap-sm wrap">
                    <LangSelect value={f.lang} onChange={lang => setP(f.key, { lang })} />
                    <select aria-label="Role" value={f.role} onChange={e => setP(f.key, { role: e.target.value as 'source' | 'target' })}><option value="source">Source</option><option value="target">Target</option></select>
                    <button type="button" className="btn ghost sm" onClick={() => setPending(x => x.filter(y => y.key !== f.key))}>Skip</button>
                  </div>
                </div>
                {!f.result.cues.length ? <p className="error small">No cues could be read from this file. Check the format in the docs.</p> : null}
                <details open={errs > 0 && errs < 20}>
                  <summary className={errs ? 'error small' : 'small'}>{f.result.issues.length ? `${errs} errors, ${f.result.issues.length - errs} warnings while reading` : 'Read cleanly'}</summary>
                  <ParseReport issues={f.result.issues} />
                </details>
              </div>
            )
          })}
          <div className="row gap end">
            <button type="button" className="btn ghost" onClick={() => setPending([])}>Cancel</button>
            <button type="button" className="btn primary" disabled={!pending.some(x => x.result.cues.length)} onClick={() => void add()}>Add {pending.filter(x => x.result.cues.length).length} track{pending.length > 1 ? 's' : ''}</button>
          </div>
        </div>
      )}
    </div>
  )
}

export function LangSelect({ value, onChange }: { value: string; onChange(v: string): void }) {
  const known = value.split(/[-_]/)[0] in LANGS
  return (
    <select aria-label="Language" value={known ? value.split(/[-_]/)[0] : value} onChange={e => onChange(e.target.value)}>
      {!known && <option value={value}>{value}</option>}
      {Object.entries(LANGS).map(([k, v]) => <option key={k} value={k}>{v} ({k})</option>)}
    </select>
  )
}

function Profile({ p }: { p: Project }) {
  const prof = getProfile(p)
  const lang = (p.tracks.find(t => t.role === 'target') ?? p.tracks[0])?.lang ?? 'en'
  const base = rulesFor(prof, lang, p.kids)
  const val = (k: keyof Rules) => (p.overrides[k] ?? base[k]) as number
  const set = (k: keyof Rules, v: number) => {
    if (!Number.isFinite(v)) return
    const o = { ...p.overrides }
    if (v === base[k]) delete o[k]
    else (o as Record<string, number>)[k] = v
    void saveProject({ ...p, overrides: o })
  }
  return (
    <div className="panel">
      <div className="panel-head"><h2>Rule profile</h2>{Object.keys(p.overrides).length > 0 && <button type="button" className="btn ghost sm" onClick={() => { const o = p.overrides; void saveProject({ ...p, overrides: {} }); toast('Back to the preset', { undo: () => void saveProject({ ...p, overrides: o }) }) }}>Reset to preset</button>}</div>
      <div className="profile-pick">
        {PROFILES.map(x => (
          <label key={x.id} className={`profile-opt${x.id === p.profileId ? ' on' : ''}`}>
            <input type="radio" name="profile" checked={x.id === p.profileId} onChange={() => void saveProject({ ...p, profileId: x.id, overrides: {} })} />
            <span><b>{x.name}</b><small className="muted">Checked {x.verified}</small></span>
          </label>
        ))}
      </div>
      <p className="small muted">{prof.source} {prof.url && <a href={prof.url} target="_blank" rel="noreferrer">Source</a>}</p>
      {Object.keys(prof.langs).length > 0 && <p className="small">{prof.langs[lang.split(/[-_]/)[0]]?.note ?? 'No language-specific values for this language; the preset defaults apply.'}</p>}
      <label className="row gap-sm small"><span className="switch"><input type="checkbox" checked={p.kids} onChange={e => void saveProject({ ...p, kids: e.target.checked })} /><span /></span> Children&rsquo;s programme reading speeds</label>
      <h3 className="mt">Custom values <small className="muted">(apply to every language in this project)</small></h3>
      <div className="inline-fields">
        {FIELDS.map(f => (
          <label key={f.k} className={`field${p.overrides[f.k] !== undefined ? ' changed' : ''}`} title={f.hint}>
            <span>{f.label}</span>
            <input type="number" step={f.step ?? 1} min={f.min} value={val(f.k)} onChange={e => set(f.k, Number(e.target.value))} />
          </label>
        ))}
      </div>
      <p className="muted tiny">Values shown resolve for {LANGS[lang.split(/[-_]/)[0]] ?? lang}. Edited fields turn this project into a custom profile.</p>
    </div>
  )
}

function Shots({ p }: { p: Project }) {
  const [text, setText] = useState('')
  const fps = p.overrides.fps ?? getProfile(p).base.fps
  const apply = (t: string) => {
    const r = parseShotList(t, fps)
    if (!r.shots.length) { toast(r.bad.length ? `No readable times. Check lines ${r.bad.slice(0, 5).join(', ')}.` : 'No shot changes found.', { tone: 'error' }); return }
    const old = p.shots
    void saveProject({ ...p, shots: r.shots })
    toast(`${r.shots.length} shot changes loaded${r.bad.length ? `, ${r.bad.length} lines skipped (${r.bad.slice(0, 4).join(', ')})` : ''}`, { tone: 'ok', undo: () => void saveProject({ ...p, shots: old }) })
    setText('')
  }
  return (
    <div className="panel">
      <div className="panel-head"><h2>Shot changes</h2><span className="muted small">{p.shots.length} loaded</span></div>
      <p className="muted small">Paste one cut per line: seconds (<code>12.48</code>), a clock (<code>00:00:12.480</code>) or SMPTE timecode (<code>00:00:12:12</code> at {fps} fps). CSV exports from an edit or a scene detector work; the first column is used. You can also scan the video for cuts on the Review tab.</p>
      <textarea rows={6} value={text} onChange={e => setText(e.target.value)} placeholder={'00:00:03.790\n00:00:21.442\n00:00:37:06'} aria-label="Shot list" className="mono" />
      <div className="row gap-sm wrap mt-sm">
        <button type="button" className="btn primary sm" disabled={!text.trim()} onClick={() => apply(text)}>Load shot list</button>
        <label className="btn ghost sm">Upload file<input type="file" accept=".txt,.csv,.edl" hidden onChange={async e => { const f = e.target.files?.[0]; if (f) apply(await f.text()); e.target.value = '' }} /></label>
        {p.shots.length > 0 && <button type="button" className="btn danger-ghost sm" onClick={() => { const old = p.shots; void saveProject({ ...p, shots: [] }); toast('Shot changes cleared', { undo: () => void saveProject({ ...p, shots: old }) }) }}>Clear</button>}
      </div>
    </div>
  )
}
