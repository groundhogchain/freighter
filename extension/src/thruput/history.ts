import type { ThruputHistoryRow } from "./types";

/** Append a page atomically with its cursor, retaining distinct events per tx. */
export const mergeThruputHistory = (
  previous: ThruputHistoryRow[],
  next: ThruputHistoryRow[],
) => {
  const rows = new Map(previous.map((row) => [row.id, row]));
  next.forEach((row) => rows.set(row.id, row));
  return [...rows.values()].sort((left, right) => {
    const a = BigInt(left.height),
      b = BigInt(right.height);
    return a === b ? left.id.localeCompare(right.id) : a > b ? -1 : 1;
  });
};
