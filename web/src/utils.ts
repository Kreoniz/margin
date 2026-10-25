import type { Kind, Media } from "./types";

export function safeURL(value: string): string | undefined {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) &&
      !url.username &&
      !url.password
      ? url.href
      : undefined;
  } catch {
    return undefined;
  }
}
export function hostname(value: string) {
  try {
    return new URL(value).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}
export function relativeDate(
  value: string | null,
  fallback = "Not checked yet",
) {
  if (!value || !Number.isFinite(Date.parse(value))) return fallback;
  const minutes = Math.max(
    0,
    Math.floor((Date.now() - Date.parse(value)) / 60000),
  );
  if (minutes < 1) return "Just now";
  if (minutes < 60) return minutes + "m ago";
  if (minutes < 1440) return Math.floor(minutes / 60) + "h ago";
  if (minutes < 10080) return Math.floor(minutes / 1440) + "d ago";
  return new Date(value).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}
export function selectMedia<
  T extends Omit<Media, "notes"> & { notes?: string },
>(
  media: T[],
  filters: { query: string; status: string; kind: Kind | "all"; tag: string },
) {
  const terms = filters.query
    .toLocaleLowerCase()
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  return media
    .filter(
      (item) =>
        (filters.status === "all" || item.status === filters.status) &&
        (filters.kind === "all" || item.kind === filters.kind) &&
        (!filters.tag || item.tags.includes(filters.tag)) &&
        terms.every((term) =>
          [
            item.title,
            item.author,
            item.description,
            item.notes || "",
            ...item.tags,
          ]
            .join(" ")
            .toLocaleLowerCase()
            .includes(term),
        ),
    )
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
}
export const publicPath = (id?: string) =>
  window.location.origin + "/shared" + (id ? "/" + id : "");
