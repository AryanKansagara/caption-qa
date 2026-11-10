import { PROFILES } from './engine/rules.ts'
import { Code, Link } from './ui.tsx'

const TOC = [['formats', 'Supported formats'], ['export', 'Getting files out of your tools'], ['shots', 'Shot lists'], ['rules', 'Rule profiles and sources'], ['checks', 'What each check means'], ['fixes', 'What auto-fix changes'], ['data', 'Where your data lives']]

export default function Docs() {
  return (
    <section className="page docs">
      <aside className="docs-toc" aria-label="On this page">
        <div className="eyebrow">Docs</div>
        <nav>{TOC.map(([id, l]) => <a key={id} href={`#${id}`}>{l}</a>)}</nav>
      </aside>
      <article className="docs-body">
        <h1>Docs</h1>
        <p className="lede">How to get subtitle files into Caption QA, which rules it applies and where each number comes from. Rule values were checked on 2026-11-09.</p>

        <h2 id="formats">Supported formats</h2>
        <table>
          <thead><tr><th>Format</th><th>Extensions</th><th>Notes</th></tr></thead>
          <tbody>
            <tr><th>SubRip</th><td>.srt</td><td>Numbering is checked for gaps and jumps. A dot instead of a comma before milliseconds is accepted with a warning. <code>&lt;i&gt;</code>, <code>&lt;b&gt;</code>, <code>&lt;u&gt;</code> are kept; <code>&lt;font&gt;</code> and <code>{'{\\an8}'}</code> are dropped.</td></tr>
            <tr><th>WebVTT</th><td>.vtt</td><td>Cue ids and settings (<code>align:</code>, <code>line:</code>) are ignored; NOTE, STYLE and REGION blocks are skipped; voice and class spans are removed.</td></tr>
            <tr><th>ASS / SSA</th><td>.ass, .ssa</td><td>Reads the <code>[Events]</code> Format line, so column order does not matter. <code>\N</code> becomes a line break, <code>{'{\\i1}'}</code>/<code>{'{\\i0}'}</code> become italics, other override codes are removed. Comment lines are ignored.</td></tr>
            <tr><th>TTML / DFXP</th><td>.ttml, .dfxp, .xml</td><td>Clock times, frame times (<code>00:00:05:10</code> with <code>ttp:frameRate</code>), offsets (<code>3s</code>, <code>1500ms</code>, ticks) and <code>dur</code>. <code>&lt;br/&gt;</code> and italic spans are kept.</td></tr>
            <tr><th>YouTube SBV</th><td>.sbv</td><td>Plain text only; formatting is dropped on export.</td></tr>
          </tbody>
        </table>
        <p>Encoding is detected per file: a BOM wins (UTF-8, UTF-16 LE/BE), then UTF-16 without a BOM is recognised by its zero bytes, then strict UTF-8, then Windows-1252. Every finding is listed with its line number before you add the file. Exports are UTF-8 without a BOM.</p>

        <h2 id="export">Getting files out of your tools</h2>
        <h3>Subtitle Edit</h3>
        <p><b>File &rarr; Save as</b> and choose SubRip (.srt) or WebVTT. For a translation, open the original with <b>File &rarr; Open original subtitle</b> first so both keep the same timecodes, then save the translation on its own.</p>
        <h3>Aegisub (.ass)</h3>
        <p>Upload the <code>.ass</code> directly; there is no need to convert first. Converting to SRT in other tools is where overlapping end times often creep in, and Caption QA flags and fixes those.</p>
        <h3>Premiere Pro and DaVinci Resolve</h3>
        <p>Premiere: select the caption track, <b>File &rarr; Export &rarr; Captions</b>, format SubRip or WebVTT. Resolve: <b>Deliver</b> page, Subtitle settings, <b>Export as a separate file</b>, format SRT or WebVTT.</p>
        <h3>YouTube</h3>
        <p>YouTube Studio &rarr; <b>Subtitles</b> &rarr; pick a language &rarr; <b>&#8942; &rarr; Download</b> (.srt or .sbv).</p>
        <h3>From a command line</h3>
        <p>Pull an embedded subtitle stream out of a video with ffmpeg:</p>
        <Code label="shell" code={'# list streams\nffprobe -hide_banner movie.mp4\n# extract the first subtitle stream as SRT\nffmpeg -i movie.mp4 -map 0:s:0 movie_en.srt'} />
        <p>Name files with a language code (<code>title_de.srt</code>, <code>title.es-ES.vtt</code>) and the language is set for you. Otherwise it is guessed from the text and you can change it.</p>

        <h2 id="shots">Shot lists</h2>
        <p>One cut per line in seconds, clock time or SMPTE timecode; for CSV the first column is used. To get one from an edit or a scene detector:</p>
        <Code label="shell" code={'# PySceneDetect: writes a CSV of scene start times\nscenedetect -i movie.mp4 detect-content list-scenes\n\n# ffmpeg scene score: one cut time per line\nffmpeg -i movie.mp4 -vf "select=gt(scene\\,0.35),showinfo" -f null - 2>&1 | grep -o "pts_time:[0-9.]*" | cut -d: -f2 > cuts.txt'} />
        <p>Without a list, load the video on the Review tab and use <b>Scan for shot changes</b>: frames are sampled every 200 ms on a 64&times;36 canvas, big jumps in brightness are treated as cuts and each one is refined to about a frame. It is a basic scan; cross-fades and flashes can fool it, so an edit list is better when you have one.</p>

        <h2 id="rules">Rule profiles and sources</h2>
        {PROFILES.map(p => (
          <div key={p.id} className="panel">
            <h3>{p.name} <small className="muted">checked {p.verified}</small></h3>
            <p className="small">{p.source} {p.url && <a href={p.url} target="_blank" rel="noreferrer">Source</a>}</p>
            <p className="small muted">Defaults: {p.base.maxCps ? `${p.base.maxCps} CPS` : `${p.base.maxWpm} WPM`}, {p.base.maxChars} characters per line, {p.base.maxLines} lines, {(p.base.minDurationMs / 1000).toFixed(3)} to {p.base.maxDurationMs / 1000} s, {p.base.minGapFrames}-frame gap at {p.base.fps} fps{p.base.closeGapFrames ? `, close gaps under ${p.base.closeGapFrames} frames` : ''}{p.base.shotChangeFrames ? `, snap within ${p.base.shotChangeFrames} frames of a shot change` : ''}.</p>
            {Object.keys(p.langs).length > 0 && <ul className="small">{Object.entries(p.langs).map(([l, o]) => <li key={l}><b>{l}</b>: {o.note ?? Object.entries(o).map(([k, v]) => `${k} ${v}`).join(', ')}</li>)}</ul>}
          </div>
        ))}
        <p>Platform guidelines change. Every value is editable per project on the Setup tab, and edits turn the project into a custom profile that is shown as such in reports.</p>

        <h2 id="checks">What each check means</h2>
        <ul>
          <li><b>Reading speed (CPS)</b>: visible characters including spaces and punctuation, divided by duration. Tags are not counted. Korean counts Latin characters as half, as the Netflix Korean guide does.</li>
          <li><b>Words per minute</b>: words counted with the browser&rsquo;s language-aware segmenter, so Japanese and Chinese are split into words rather than on spaces.</li>
          <li><b>Line breaks</b>: a cue that fits on one line should be on one line; line one should not end on an article, preposition or conjunction (lists for English, Spanish, German, French, Italian and Portuguese); a more balanced, bottom-heavy break is suggested when one exists. Dialogue cues starting with dashes are left alone.</li>
          <li><b>Gaps</b>: below the minimum is an error. With the Netflix-style preset, gaps under 12 frames (half a second) should be closed to 2 frames.</li>
          <li><b>Shot changes</b>: an in-time a few frames off a cut should move onto it; an out-time near a cut should end 2 frames before it.</li>
          <li><b>Translation</b>: each target cue is aligned to the source cues it overlaps in time. Lines over 45% longer or 45% shorter than the source are flagged; identical text is flagged as untranslated; digits and capitalised names must survive.</li>
          <li><b>Score</b>: 100 means clean. Each error costs a cue&rsquo;s share of the total, each warning 0.35 of one, capped at 3 per cue.</li>
        </ul>

        <h2 id="fixes">What auto-fix changes</h2>
        <p>In order: overlaps (end the earlier cue 2 frames before the next), sub-minimum gaps, splits for over-long cues (at a sentence end where possible, timed by length), re-breaks, shot-change snaps, closing short gaps, extending cues that read too fast into the following gap (or the previous one), borrowing time from a next cue that has more than it needs, and merging flashing cues that have no room. It never changes words. Each change can be accepted or rejected on the Fixes tab, and every accept can be undone.</p>
        <p>Fast reading speed that retiming cannot solve is left for a person: usually the translation needs condensing.</p>

        <h2 id="data">Where your data lives</h2>
        <p>Projects are stored in this browser (IndexedDB). Video files are opened as local object URLs for preview, waveform and shot detection and are never uploaded or stored. Signing in is optional; it syncs projects (tracks, rule edits, shot changes) and snapshots to your account. A project larger than about 3 MB syncs without its cue data, which then stays on the device that imported it. You can export or delete everything from the account menu.</p>
        <p><Link href="/app">Open your projects</Link></p>
      </article>
    </section>
  )
}
