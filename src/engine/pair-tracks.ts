interface Keyed { id: string; lang: string; role: string }

/** Tracks of two versions side by side: matched by id, then by language and role in file order, the rest on their own. */
export function pairTracks<T extends Keyed>(a: T[], b: T[]): { key: string; a?: T; b?: T }[] {
  const ids = new Set(a.map(t => t.id))
  const free = b.filter(t => !ids.has(t.id))
  const pairs = a.map(x => {
    let y = b.find(t => t.id === x.id)
    if (!y) {
      const k = free.findIndex(t => t.lang === x.lang && t.role === x.role)
      if (k >= 0) y = free.splice(k, 1)[0]
    }
    return { key: x.id, a: x as T | undefined, b: y }
  })
  return [...pairs, ...free.map(t => ({ key: t.id, a: undefined, b: t }))]
}
