import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseShotList } from './parse.ts'

const row = (n: number, frame: number, tc: string, s: string) => `${n},${frame},${tc},${s},999,00:01:00.000,60.000,10,00:00:01.000,1.000`
const HEADER = 'Scene Number,Start Frame,Start Timecode,Start Time (seconds),End Frame,End Timecode,End Time (seconds),Length (frames),Length (timecode),Length (seconds)'

test('PySceneDetect scene lists use the start time, with and without the cut list row', () => {
  const body = [HEADER, row(1, 1, '00:00:00.000', '0.000'), row(2, 121, '00:00:05.005', '5.005'), row(3, 229, '00:00:09.510', '9.510')]
  for (const text of [body, ['Timecode List:,00:00:05.005,00:00:09.510', ...body]]) {
    for (const eol of ['\n', '\r\n']) assert.deepEqual(parseShotList(text.join(eol)), { shots: [5005, 9510], bad: [] })
  }
  assert.deepEqual(parseShotList([...body, '4,300'].join('\n')).bad, [5], 'cut-off row')
  assert.deepEqual(parseShotList(body.slice(1).join('\n')), { shots: [], bad: [1, 2, 3] }, 'no header')
})

test('separators inside times', () => {
  assert.deepEqual(parseShotList('00:00:12;12\n00:00:13,480\n00:00:14,480,x\n01:15,250').shots, [12500, 13480, 14480, 75250])
  assert.deepEqual(parseShotList('12,48\n00:00:12:30\n00:00:75:00\n00:75:00:00\n00:00:10;24'), { shots: [], bad: [1, 2, 3, 4, 5] })
})

test('plain lists and first-column CSVs read as before', () => {
  assert.deepEqual(parseShotList('1.5,cut\n2\n5,00:00:05.000\n00:00:07:12,dissolve\n9\t12\n# note\n'), { shots: [1500, 2000, 5000, 7500, 9000], bad: [] })
})
