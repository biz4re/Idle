import type { Favourite, LaterItem } from './ipc'

export function searchSavedPages(query: string, favourites: Favourite[], later: LaterItem[]): { favourites: Favourite[]; later: LaterItem[] } {
  const term = query.trim().toLocaleLowerCase()
  if (!term) return { favourites: [], later: [] }
  return {
    favourites: favourites.filter((item) => `${item.title} ${item.url}`.toLocaleLowerCase().includes(term)),
    later: later.filter((item) => `${item.title} ${item.url} ${item.note}`.toLocaleLowerCase().includes(term)),
  }
}
