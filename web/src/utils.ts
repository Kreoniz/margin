import type { Kind, Media, Source } from "./types";

export function discoveryEmptyState(sources: Source[], state: string) {
  if (state !== "new") return { heading: `No ${state} articles.`, description: "Your discoveries will appear here when you change their status." };
  if (!sources.length) return { heading: "Follow something worth reading.", description: "Add a source to start collecting articles in Discover." };
  const enabled = sources.filter(s => s.enabled);
  if (!enabled.length) return { heading: "Collection is paused.", description: "Resume a source to collect new articles." };
  if (enabled.some(s => s.last_error)) return { heading: "Sources need attention.", description: "Some sources could not be checked. Open Sources for details and retry." };
  if (enabled.some(s => !s.last_sync)) return { heading: "Checking your sources…", description: "The first articles will appear after collection finishes." };
  return { heading: "You’re all caught up.", description: "Your sources keep collecting in the background. Save the articles you want to come back to." };
}

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
  filters: { query: string; status: string; kinds: readonly Kind[]; tags: readonly string[]; channels?: readonly string[] },
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
        (!filters.kinds.length || filters.kinds.includes(item.kind)) &&
        (!filters.tags.length || item.tags.some(tag => filters.tags.includes(tag))) &&
        (!filters.channels?.length || filters.channels.includes(youtubeChannelName(item)?.toLocaleLowerCase() || "")) &&
        terms.every((term) =>
          [
            item.title,
            item.author,
            item.url,
            item.description,
            item.notes || "",
            item.selected_text || "",
            item.selected_text_source_url || "",
            ...item.tags,
          ]
            .join(" ")
            .toLocaleLowerCase()
            .includes(term),
        ),
    )
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
}
export function youtubeChannelName(item: Pick<Media, "kind" | "url" | "author">): string | undefined {
  if (item.kind !== "video" || !item.author.trim()) return undefined;
  return ["youtube.com", "m.youtube.com", "music.youtube.com", "youtu.be", "youtube-nocookie.com"].includes(hostname(item.url)) ? item.author.trim() : undefined;
}
export const publicPath = (id?: string) =>
  window.location.origin + (id ? "/shared" : "") + (id ? "/" + id : "");

export function imageURL(value: string): string | undefined {
  return /^\/api\/images\/[0-9a-f-]{36}$/i.test(value) ? value : safeURL(value);
}

export function publisherImage(raw: string): string | undefined {
  if (!safeURL(raw)) return undefined;
  const url = new URL(raw);
  const host = url.hostname.replace(/^www\./, "");
  if (host === "openai.com") return "/brands/openai.svg";
  if (host === "anthropic.com") return "/brands/anthropic.svg";
  if (host === "thinkingmachines.ai") return "/brands/thinkingmachines.png";
  if (host === "deepmind.google" || host === "deepmind.com") return "/brands/deepmind.svg";
  if (host === "huggingface.co") return "/brands/huggingface.svg";
  return new URL("/favicon.ico", url.origin).href;
}

export function isFallbackTitle(title: string, raw: string): boolean {
  try {
    const url = new URL(raw);
    const host = url.hostname.replace(/^www\./, "");
    const parts = url.pathname.split("/").filter(Boolean);
    const youtubeHost = ["youtube.com", "m.youtube.com", "music.youtube.com", "youtube-nocookie.com"].includes(host);
    const video = host === "youtu.be" && parts.length === 1 ? parts[0]
      : youtubeHost && url.pathname === "/watch" ? url.searchParams.get("v")
        : youtubeHost && parts.length === 2 && ["shorts", "embed", "live"].includes(parts[0]) ? parts[1] : "";
    if (video && /^[A-Za-z0-9_-]{11}$/.test(video) &&
      (/^(?:youtube|- youtube|watch)?$/i.test(title.trim()) || /before you continue|consent\.youtube|sign in to confirm/i.test(title))) return true;
    const name = decodeURIComponent(
      url.pathname.split("/").filter(Boolean).at(-1) || "",
    )
      .replace(/\.(?:html?|pdf|php)$/i, "")
      .replace(/[-_]/g, " ");
    return title === raw || title === url.hostname || title === name;
  } catch {
    return false;
  }
}
