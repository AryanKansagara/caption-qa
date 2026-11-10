import { useEffect, useState } from 'react'
import { langName } from './engine/rules.ts'
import { createBlankProject, createSampleProject, getProfile, qcTrack } from './projectData.ts'
import { deleteProject, saveProject, useProjects, type Project } from './store.ts'
import { useSync } from './sync.ts'
import { ask, go, Link, SyntheticBadge, toast } from './ui.tsx'

export default function Workspace() {
  const list = useProjects()
  const sync = useSync()
  const [busy, setBusy] = useState(false)

  // /app?sample=1 opens (or creates) the sample straight away.
  useEffect(() => {
    const q = new URLSearchParams(location.search)
    if (!q.get('sample') || list === null || busy) return
    const tab = q.get('tab')?.replace(/[^a-z]/g, '')
    setBusy(true)
    void createSampleProject().then(p => go(`/app/p/${p.id}${tab ? '/' + tab : ''}`, { replace: true }))
  }, [list, busy])

  const openSample = async () => { setBusy(true); const p = await createSampleProject(); go(`/app/p/${p.id}`) }
  const newProject = async () => {
    const p = await createBlankProject(`Project ${(list?.filter(p => !p.sampleId).length ?? 0) + 1}`)
    go(`/app/p/${p.id}/setup`)
  }

  if (list === null || busy) return <div className="boot" role="status"><span className="spinner" /> {busy ? 'Loading the sample' : 'Opening your projects'}</div>

  return (
    <section className="page">
      <div className="page-head">
        <div>
          <div className="eyebrow">Workspace</div>
          <h1>Projects</h1>
          <p className="muted">One project per title or episode: its source track, every translation, the rule profile, shot changes and delivery snapshots. {sync.user ? 'Synced to your account.' : 'Stored on this device.'}</p>
        </div>
        {list.length > 0 && <button type="button" className="btn primary" onClick={newProject}>New project</button>}
      </div>

      {list.length === 0 ? (
        <div className="onboard">
          <article className="onboard-card feature-card">
            <div className="eyebrow">One minute</div>
            <h2>Try the sample</h2>
            <p>A synthetic English documentary short with Spanish and German subtitles. German runs 31% longer and came through a bad .ass conversion; Spanish has an untranslated line and a changed number.</p>
            <button type="button" className="btn primary" onClick={() => void openSample()}>Open the sample</button>
          </article>
          <article className="onboard-card">
            <div className="eyebrow">Your files</div>
            <h2>Import your subtitles</h2>
            <p>Drop a source track and any number of translations: SRT, VTT, ASS/SSA, TTML/DFXP or SBV. Format, encoding and language are detected and every problem is reported with its line number.</p>
            <div className="row gap wrap">
              <button type="button" className="btn primary" onClick={newProject}>Import your files</button>
              <Link href="/docs" className="btn ghost">Export guides</Link>
            </div>
            <p className="muted small">Files are parsed in your browser and stay on this device unless you sign in to sync.</p>
          </article>
        </div>
      ) : (
        <>
          <div className="project-grid">{list.map(p => <ProjectCard key={p.id} p={p} />)}</div>
          {!list.some(p => p.sampleId) && <div className="samples-row"><span className="muted small">Sample:</span><button type="button" className="linkish small" onClick={() => void openSample()}>Mill Lane (EN, ES, DE)</button></div>}
        </>
      )}
    </section>
  )
}

function ProjectCard({ p }: { p: Project }) {
  const [renaming, setRenaming] = useState(false)
  const qc = p.tracks.map(t => qcTrack(p, t))
  return (
    <article className="project-card">
      <div className="row between">
        {renaming ? (
          <form onSubmit={e => { e.preventDefault(); const v = String(new FormData(e.currentTarget).get('n')).trim(); if (v) void saveProject({ ...p, name: v }); setRenaming(false) }}>
            <input name="n" defaultValue={p.name} autoFocus aria-label="Project name" onBlur={e => e.currentTarget.form?.requestSubmit()} />
          </form>
        ) : <h3><Link href={`/app/p/${p.id}`}>{p.name}</Link></h3>}
        {p.sampleId && <SyntheticBadge />}
      </div>
      <div className="lang-scores">
        {qc.length ? qc.map(q => (
          <span key={q.track.id} className={`lang-score ${q.score >= 80 ? 'good' : q.score >= 50 ? 'mid' : 'bad'}`} title={`${langName(q.track.lang)} ${q.track.role}: ${q.errors} errors, ${q.warnings} warnings`}>
            <b>{q.track.lang.toUpperCase()}</b>{q.score}
          </span>
        )) : <span className="muted small">No tracks yet</span>}
      </div>
      <p className="muted small">{getProfile(p).short}{Object.keys(p.overrides).length ? ' (custom)' : ''} · {p.snapshots.length} snapshot{p.snapshots.length === 1 ? '' : 's'} · updated {new Date(p.updatedAt).toLocaleDateString()}</p>
      {p.tracksLocal && <p className="warn-text small">Cue data is too large to sync; it lives on the device that imported it.</p>}
      <div className="row gap-sm end">
        <button type="button" className="btn ghost sm" onClick={() => setRenaming(true)}>Rename</button>
        <button type="button" className="btn danger-ghost sm" onClick={async () => {
          if (!(await ask(`Delete “${p.name}”?`, 'Removes the project, its tracks and its snapshots from this device (and the cloud, if you are signed in). You can undo for a few seconds.', 'Delete project'))) return
          const undo = await deleteProject(p.id)
          toast(`Deleted ${p.name}`, { undo: () => void undo() })
        }}>Delete</button>
      </div>
    </article>
  )
}
