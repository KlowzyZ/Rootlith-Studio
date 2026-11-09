import type { Report } from "../workflow-engine";
export type HistoryFilter = {
  search: string;
  mode: string;
  status: string;
  order: string;
  favoritesOnly: boolean;
};
export function filterHistory(
  reports: Report[],
  favorites: string[],
  filter: HistoryFilter,
) {
  const query = filter.search.trim().toLocaleLowerCase();
  return reports
    .filter(
      (r) =>
        (!query ||
          [r.workflow, ...r.steps.map((s) => s.label)].some((s) =>
            s.toLocaleLowerCase().includes(query),
          )) &&
        (filter.mode === "all" || (filter.mode === "simulated") === r.demo) &&
        (filter.status === "all" ||
          r.steps.some((s) => s.status === filter.status)) &&
        (!filter.favoritesOnly || favorites.includes(r.id)),
    )
    .sort(
      (a, b) =>
        (Date.parse(a.date) - Date.parse(b.date)) *
        (filter.order === "oldest" ? 1 : -1),
    );
}
export function retainedFavorites(reports: Report[], favorites: string[]) {
  return [...new Set(favorites)]
    .filter((id) => reports.some((r) => r.id === id))
    .slice(0, 50);
}
