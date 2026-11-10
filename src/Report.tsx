import { useEffect } from 'react'
import { RULES, ruleLabel } from './engine/check.ts'
import { langName } from './engine/rules.ts'
import { FORMAT_LABEL } from './engine/types.ts'
import { fmtT, issuesCsv, plainText, scoreClass, summaryCsv } from './Project.tsx'
import { getProfile, isCustom, useProject, useQC } from './projectData.ts'
import { download, Link, NotFound } from './ui.tsx'

export default function Report({ id }: { id: string }) {
  const { loading, project: p } = useProject(id)
  const qc = useQC(p)
  useEffect(() => { if (p) document.title = `QC report · ${p.name}` }, [p?.name])
  if (loading) return <div className="boot"><span className="spinner" /> Building report</div>
  if (!p) return <NotFound />
  const prof = getProfile(p)
  const overall = qc.length ? Math.round(qc.reduce((a, q) => a + q.score, 0) / qc.length) : 0
  return (
    <div className="report">
      <div className="report-bar no-print">
        <Link href={`/app/p/${p.id}/export`} className="btn ghost sm">&larr; Back</Link>
        <div className="row gap-sm">
          <button type="button" className="btn ghost sm" onClick={() => download(`${p.name}-qc-issues.csv`, issuesCsv(qc))}>Issues CSV</button>
          <button type="button" className="btn ghost sm" onClick={() => download(`${p.name}-qc-summary.csv`, summaryCsv(qc))}>Summary CSV</button>
          <button type="button" className="btn primary sm" onClick={() => print()}>Print or save PDF</button>
        </div>
      </div>
      <header className="report-head">
        <div>
          <div className="eyebrow">Subtitle QC report</div>
          <h1>{p.name}</h1>
          <p className="muted">{new Date().toLocaleString('en-GB', { dateStyle: 'long', timeStyle: 'short' })} · {prof.name}{isCustom(p) ? ' with custom values' : ''}{p.kids ? ', children’s reading speeds' : ''} · preset checked {prof.verified}</p>
          {p.sampleId && <p className="small warn-text">Synthetic sample written for this tool. Not real subtitles.</p>}
        </div>
        <div className={`report-score ${scoreClass(overall)}`}><b>{overall}</b><span>average score</span></div>
      </header>

      <table className="report-table">
        <thead><tr><th>Track</th><th>File</th><th className="num">Cues</th><th className="num">Score</th><th className="num">Errors</th><th className="num">Warnings</th><th>Result</th></tr></thead>
        <tbody>{qc.map(q => (
          <tr key={q.track.id}><th>{langName(q.track.lang)} <small>{q.track.role}</small></th><td className="small">{q.track.fileName}<br /><span className="muted">{FORMAT_LABEL[q.track.format]}</span></td><td className="num">{q.track.cues.length}</td><td className="num"><b>{q.score}</b></td><td className="num">{q.errors}</td><td className="num">{q.warnings}</td><td><span className={`badge ${q.errors ? 'severe' : 'low'}`}>{q.errors ? 'Fail' : 'Pass'}</span></td></tr>
        ))}</tbody>
      </table>

      <h2>Pass / fail per rule</h2>
      <table className="report-table matrix-print">
        <thead><tr><th>Rule</th>{qc.map(q => <th key={q.track.id} className="num">{q.track.lang.toUpperCase()}</th>)}</tr></thead>
        <tbody>{RULES.map(r => (
          <tr key={r.id}><th>{r.label}</th>{qc.map(q => { const s = q.summary.find(x => x.id === r.id); return <td key={q.track.id} className="num">{!s ? <span className="muted">n/a</span> : <span className={s.pass ? (s.warnings ? 'warn-text' : 'good-text') : 'error'}>{s.pass ? 'Pass' : 'Fail'}{s.errors + s.warnings ? ` (${s.errors}/${s.warnings})` : ''}</span>}</td> })}</tr>
        ))}</tbody>
      </table>
      <p className="muted small">Counts are errors / warnings. Limits: {qc[0] ? `${qc[0].rules.maxChars} chars per line, ${qc[0].rules.maxLines} lines, ${(qc[0].rules.minDurationMs / 1000).toFixed(2)} to ${qc[0].rules.maxDurationMs / 1000} s, ${qc[0].rules.minGapFrames}-frame gaps at ${qc[0].rules.fps} fps` : ''}; reading speed per language: {qc.map(q => `${q.track.lang.toUpperCase()} ${q.rules.maxCps ? q.rules.maxCps + ' CPS' : q.rules.maxWpm + ' WPM'}`).join(', ')}.</p>

      {qc.map(q => (
        <section key={q.track.id} className="report-track">
          <h2>{langName(q.track.lang)} · {q.issues.length} issue{q.issues.length === 1 ? '' : 's'} <span className={`score-chip ${scoreClass(q.score)}`}>{q.score}</span></h2>
          {q.expansion !== null && <p className="small muted">Length against source: {q.expansion >= 1 ? '+' : ''}{Math.round((q.expansion - 1) * 100)}%.</p>}
          {q.issues.length === 0 ? <p className="good-text">No issues.</p> : (
            <table className="report-table issues">
              <thead><tr><th>#</th><th>In</th><th>Rule</th><th>Finding</th><th>Text</th></tr></thead>
              <tbody>{q.issues.map((i, k) => { const n = q.track.cues.findIndex(c => c.id === i.cueId); const c = q.track.cues[n]; return (
                <tr key={k} className={i.severity}><td className="mono">{n + 1}</td><td className="mono">{fmtT(c.start)}</td><td>{ruleLabel(i.rule)}{i.severity === 'error' ? '' : ' (warn)'}</td><td>{i.message}</td><td className="pre small">{plainText(c.text)}</td></tr>
              ) })}</tbody>
            </table>
          )}
        </section>
      ))}
      <footer className="report-foot muted small">Caption QA · Built by Aryan Kansagara. Independent project, not affiliated with HeyGen.</footer>
    </div>
  )
}
