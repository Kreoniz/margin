export const kinds = [
  "book",
  "article",
  "paper",
  "video",
  "movie",
  "anime",
  "manga",
  "game",
  "other",
] as const;
export type Kind = (typeof kinds)[number];
export type Status = "pending" | "done";
export type Visibility = "private" | "public";
export interface Media {
  metadata_state?: "pending" | "ready" | "partial";
  metadata_warning?: string;
  needs_review?: boolean;
  id: string;
  title: string;
  author: string;
  kind: Kind;
  status: Status;
  url: string;
  cover_url: string;
  description: string;
  notes: string;
  tags: string[];
  visibility: Visibility;
  created_at: string;
  updated_at: string;
  completed_at?: string;
}
export type PublicMedia = Omit<
  Media,
  "notes" | "needs_review" | "metadata_state" | "metadata_warning"
>;
export type MediaDraft = Omit<
  Media,
  | "id"
  | "created_at"
  | "updated_at"
  | "completed_at"
  | "needs_review"
  | "metadata_state"
  | "metadata_warning"
>;
export interface InboxItem {
  id: string;
  source_id: string;
  source_name: string;
  title: string;
  author: string;
  url: string;
  cover_url: string;
  description: string;
  published_at: string;
  discovered_at: string;
  state: "new" | "read" | "dismissed" | "saved";
}
export interface Source {
  id: string;
  name: string;
  site_url: string;
  feed_url: string;
  parser: string;
  enabled: boolean;
  auto_save: boolean;
  interval_minutes: number;
  last_sync: string | null;
  next_sync: string | null;
  last_error: string;
  item_count: number;
}
export interface LibraryData {
  dev_mode?: boolean;
  dev_fixture_count?: number;
  media: Media[];
  inbox: InboxItem[];
  sources: Source[];
  legacy_sample_count: number;
}
export interface Session {
  authenticated: boolean;
  setup_required: boolean;
}
export interface Metadata {
  title: string;
  author: string;
  kind: Kind;
  url: string;
  cover_url: string;
  description: string;
  warning?: string;
}
export const kindLabels: Record<Kind, string> = {
  book: "Book",
  article: "Article",
  paper: "Paper",
  video: "Video",
  movie: "Movie",
  anime: "Anime",
  manga: "Manga",
  game: "Game",
  other: "Other",
};
export const emptyDraft = (): MediaDraft => ({
  title: "",
  author: "",
  kind: "article",
  status: "pending",
  url: "",
  cover_url: "",
  description: "",
  notes: "",
  tags: [],
  visibility: "private",
});
