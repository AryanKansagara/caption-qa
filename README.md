# Caption QA

Subtitle and caption quality control for localisation and video teams. Drop a source track and its translations (SRT, WebVTT, ASS/SSA, TTML/DFXP, SBV) and Caption QA checks them against real style-guide rules, fixes what retiming can fix, and shows the rest side by side with the source.

Live: https://caption-qa.vercel.app

## The pain

Word-for-word subtitles routinely run faster than platform reading-speed limits, timing is still checked by watching the whole cut at normal speed, `.ass` to `.srt` conversions leave overlapping end times, and translations drift off the original timecodes or quietly drop numbers and names. Most of this is mechanical and should be caught before delivery.

## Features

- **Import**: SRT, VTT, ASS/SSA, TTML/DFXP, SBV with encoding detection (UTF-8, UTF-16 LE/BE, Windows-1252, BOMs) and a validation report with line numbers (bad timecodes, overlaps, negative durations, broken numbering). Language guessed from file name or text.
- **Rule profiles**: dated Netflix-style presets per language (checked against the Netflix Partner Help Center on 2026-11-09), BBC-style words per minute, a social preset and custom values per project. Children's reading speeds.
- **Checks**: CPS and language-aware WPM, line length and break quality, line count, flashing and over-long cues, overlaps and gaps, shot-change proximity, translation expansion, untranslated lines, number and name consistency, forbidden characters and tags. Score and pass/fail per rule.
- **Auto-fix with review**: overlap and gap repair, extending into gaps or borrowing from neighbours, merges, splits, re-breaking, shot-change snapping. Accept or reject each change, with undo.
- **Sync tools**: shift, two-point linear resync, 23.976 / 25 fps conversion.
- **Review**: local video preview (never uploaded) with a WebAudio waveform, a zoomable timeline, shot-change scan in the browser, side-by-side source/target with inline editing.
- **Batch**: language by issue matrix and auto-fix across every track.
- **Deliverables**: fixed files in any supported format, printable QC report, issues and summary CSV, project JSON.
- **History**: snapshots per delivery version with a compare view and cue-level diff.
- **Accounts (optional)**: email sign-in syncs projects and snapshots across devices; everything works signed out.

The sample (an English documentary short with Spanish and German subtitles) is synthetic and written for this tool.

## Run locally

```sh
npm install
cp .env.example .env   # optional: public Supabase URL and publishable key for sync
npm run dev
npm test               # engine tests
npm run build
```
