/** Spreadsheets run a cell that starts with one of these as a formula, also when it is quoted. A leading ' keeps it text. */
const FORMULA = /^[=+\-@\t\r]/

const cell = (s: string) => {
  const v = FORMULA.test(s) ? `'${s}` : s
  return /[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v
}

export const toCsv = (rows: string[][]) => rows.map(r => r.map(cell).join(',')).join('\n') + '\n'
