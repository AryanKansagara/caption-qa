// Synthetic sample, written from scratch for this tool: a short documentary-style piece about a fictional bakery.
// English source plus Spanish and German translations with planted problems:
// - German runs about 30% longer on the English timing, so reading speed breaks on most cues.
// - German comes from a bad .ass conversion with overlapping end times.
// - Spanish has an untranslated line, a changed number, a flashing cue and an unclosed italic tag.
// - English has weak line breaks and in-times a few frames off the shot changes.
import { serialize } from './serialize.ts'
import type { Cue } from './types.ts'

const LINES: [en: string, es: string, de: string][] = [
  ['Every morning at four,\nthe ovens at Mill Lane Bakery come on.', 'Cada mañana a las cuatro se encienden los hornos de Mill Lane Bakery.', 'Jeden Morgen um vier werden die Öfen\nder Mill Lane Bakery angeheizt.'],
  ["I'm Priya.\nI've baked here for eleven years.", 'Soy Priya. Llevo once años horneando aquí.', 'Ich bin Priya. Ich backe hier\nschon seit elf Jahren.'],
  ['The first job is the sourdough.\nIt needs 36 hours, start to finish.', 'Lo primero es la masa madre.\nNecesita 36 horas de principio a fin.', 'Die erste Aufgabe ist immer der Sauerteig.\nEr braucht von Anfang bis Ende 36 Stunden.'],
  ['We feed the starter twice a day, with the\nflour from a mill in Kent.', 'Alimentamos la masa madre dos veces al día\ncon harina de un molino de Kent.', 'Wir füttern den Sauerteigansatz zweimal am Tag\nmit Mehl aus einer Mühle in Kent.'],
  ['Temperature matters\nmore than anything else.', 'La temperatura importa más\nque cualquier otra cosa.', 'Die Temperatur ist wichtiger\nals alles andere.'],
  ['At 24 degrees, the dough doubles\nin about five hours.', 'A 24 grados, la masa dobla su tamaño\nen unas cinco horas.', 'Bei 24 Grad verdoppelt der Teig sein Volumen\nin ungefähr fünf Stunden.'],
  ['Too warm, and it turns sour and slack.', 'Si hace demasiado calor, se vuelve ácida y floja.', 'Ist es zu warm, wird er viel zu sauer\nund verliert seine Spannung.'],
  ['Tom handles the croissants.', 'Tom se encarga de los cruasanes.', 'Tom kümmert sich um die Croissants.'],
  ['Each batch is folded three times,\nwith 27 layers of butter.', 'Cada tanda se pliega tres veces,\ncon 72 capas de mantequilla.', 'Jede Charge wird dreimal gefaltet\nund hat am Ende 27 Schichten Butter.'],
  ['Rush it and the butter breaks through.', 'Si vas con prisa, la mantequilla se rompe.', 'Wer sich hier beeilt, riskiert, dass die\nButter durch den Teig bricht.'],
  ['By six, the first\ncustomers are at the door.', 'A las seis, los primeros clientes\nya están en la puerta.', 'Um sechs Uhr stehen die ersten Kundinnen\nund Kunden schon vor der Tür.'],
  ['Most of them are regulars.\nMrs. Okafor has come every day since 2009.', 'Casi todos son habituales.\nLa señora Okafor viene a diario desde 2009.', 'Die meisten sind Stammkunden. Frau Okafor\nkommt seit 2009 wirklich jeden Tag vorbei.'],
  ['-Good morning!\n-Morning, Mrs. Okafor.', '-Good morning!\n-Morning, Mrs. Okafor.', '-Guten Morgen!\n-Morgen, Frau Okafor.'],
  ['The usual?\nOne rye loaf and a cardamom bun.', '¿Lo de siempre? Un pan de centeno\ny un bollo de cardamomo.', 'Wie immer? Ein Roggenbrot und eine\nKardamomschnecke, bitte sehr.'],
  ['Bread is a small thing,\nbut people plan their day around it.', 'El pan es algo pequeño, pero la gente\norganiza su día en torno a él.', 'Brot ist eine Kleinigkeit, aber die Leute\nplanen ihren ganzen Tag darum herum.'],
  ['<i>Rain is expected after lunch.</i>', '<i>Se espera lluvia después de comer.', '<i>Nach dem Mittagessen wird mit Regen gerechnet.</i>'],
  ['At noon we start again for tomorrow.', 'A mediodía empezamos de nuevo para mañana.', 'Mittags fangen wir wieder ganz von vorne\nfür den nächsten Tag an.'],
  ["It never really stops.\nThat's the part I love.", 'Nunca se detiene del todo.\nEso es lo que más me gusta.', 'Es hört nie richtig auf.\nGenau das liebe ich daran.'],
  ['Synthetic sample for Caption QA.\nNot a real bakery.', 'Muestra sintética para Caption QA.\nNo es una panadería real.', 'Synthetisches Beispiel für Caption QA.\nKeine echte Bäckerei.'],
]

// Gap after each cue in ms: mostly chained at 2 frames, a few real pauses, two awkward 250 ms gaps.
const GAPS = [84, 600, 84, 84, 250, 84, 900, 84, 84, 700, 84, 84, 84, 250, 1200, 84, 84, 600, 0]

function timeline(): Cue[] {
  let t = 1000
  return LINES.map(([en], i) => {
    const chars = en.replace(/<[^>]+>/g, '').replace(/\n/g, '').length
    const dur = Math.round(Math.max(1500, chars / 15 * 1000) / 10) * 10
    const c = { id: `c${i + 1}`, start: t, end: t + dur, text: en }
    t += dur + GAPS[i]
    return c
  })
}

const EN = timeline()

export const SAMPLE_SHOTS = [EN[2].start - 210, EN[7].start, EN[10].start + 125, EN[13].start - 290, EN[16].start, EN[16].end + 250]

export const SAMPLE_FILES: { lang: string; name: string; role: 'source' | 'target'; text: string }[] = [
  { lang: 'en', role: 'source', name: 'mill-lane_en.srt', text: serialize(EN, 'srt') },
  {
    lang: 'es', role: 'target', name: 'mill-lane_es.vtt',
    text: serialize(EN.map((c, i) => ({ ...c, text: LINES[i][1], end: i === 7 ? c.start + 560 : c.end })), 'vtt'),
  },
  {
    lang: 'de', role: 'target', name: 'mill-lane_de.ass',
    // The bad conversion rounded every end time up and added 400 ms to some, which overlaps the next cue.
    text: serialize(EN.map((c, i) => ({ ...c, text: LINES[i][2], end: c.end + ([2, 3, 8, 10, 11, 16].includes(i) ? 400 : 0) })), 'ass', { title: 'Mill Lane (synthetic) German' }),
  },
]

export const SAMPLE_SHOT_LIST = SAMPLE_SHOTS.map(ms => `${(ms / 1000).toFixed(3)}`).join('\n')
