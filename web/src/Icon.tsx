import type { CSSProperties } from "react";

const paths = {
  lock: "M6 10h12v11H6zM8 10V7a4 4 0 0 1 8 0v3M12 14v3",
  globe:
    "M12 3a9 9 0 1 1 0 18 9 9 0 0 1 0-18ZM3 12h18M12 3c5 5 5 13 0 18-5-5-5-13 0-18Z",
  settings:
    "M19.85 8.75 22.34 10.18v3.64l-2.49 1.43.75 2.77-2.58 2.58-2.77-.75-1.43 2.49h-3.64l-1.43-2.49-2.77.75-2.58-2.58.75-2.77-2.49-1.43v-3.64l2.49-1.43-.75-2.77L5.98 3.4l2.77.75 1.43-2.49h3.64l1.43 2.49 2.77-.75 2.58 2.58-.75 2.77ZM15.5 12a3.5 3.5 0 1 1-7 0 3.5 3.5 0 0 1 7 0Z",
  copy: "M8 8h13v13H8zM16 8V3H3v13h5",
  logout: "M9 3H3v18h6M8 12h13m-5-5 5 5-5 5",
  library: "M4 5h4v15H4zM10 5h4v15h-4zM16 5l3-1 4 14-3 1z",
  book: "M12 6c-3-2-6-2-9-1v14c3-1 6-1 9 1m0-14c3-2 6-2 9-1v14c-3-1-6-1-9 1V6Z",
  article:
    "M6 3h12a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2ZM8 7h8M8 11h8M8 15h5",
  paper:
    "M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6Zm0 0v6h6M8 12h8M8 16h5",
  video:
    "m10 8 6 4-6 4V8ZM5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z",
  movie: "M3 3h18v18H3zM7 3v18M17 3v18M3 8h4M3 16h4M17 8h4M17 16h4",
  anime: "M12 3 9 9l-6 3 6 3 3 6 3-6 6-3-6-3-3-6Z",
  manga: "M3 3h18v18H3zM3 10h18M10 10v11M15 3v7",
  game: "M7 7h10c3 0 4 3 5 10 .3 3-2 4-4 1l-2-3H8l-2 3c-2 3-4.3 2-4-1 1-7 2-10 5-10ZM7 9v5M4.5 11.5h5M16 10h.01M19 13h.01",
  other: "M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z",
  inbox: "M4 4h16l2 11v5H2v-5L4 4Zm-2 11h6l2 3h4l2-3h6",
  active: "M12 3a9 9 0 1 1-9 9M12 3v9l6 3M5 4v4H1",
  clock: "M12 3a9 9 0 1 1 0 18 9 9 0 0 1 0-18Zm0 4v5l3 2",
  check: "m5 12 4 4L19 6",
  complete: "M21 11v1a9 9 0 1 1-5.3-8.2M21 4l-9 9-3-3",
  heart:
    "M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z",
  star: "m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9L12 3Z",
  plus: "M12 5v14M5 12h14",
  search: "M10.5 3a7.5 7.5 0 1 1 0 15 7.5 7.5 0 0 1 0-15ZM16 16l5 5",
  arrow: "M4 12h16m-6-6 6 6-6 6",
  external:
    "M15 3h6v6m0-6L10 14M9 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-4",
  close: "m6 6 12 12M6 18 18 6",
  grid: "M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z",
  list: "M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01",
  rss: "M4 11a9 9 0 0 1 9 9M4 4a16 16 0 0 1 16 16M4 20h.01",
  sync: "M20 7v5h-5M4 17v-5h5M5.7 7a7 7 0 0 1 11.6-2L20 8M4 16l2.7 3A7 7 0 0 0 18.3 17",
  link: "m10 13 4-4M8 16l-1 1a4 4 0 0 1-6-6l5-5a4 4 0 0 1 6 0m0 2 1-1a4 4 0 0 1 6 6l-5 5a4 4 0 0 1-6 0",
  edit: "m16 3 5 5-12 12-6 1 1-6L16 3Zm-2 2 5 5",
  trash: "M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7",
  menu: "M4 6h16M4 12h16M4 18h16",
  tag: "M21 12 12 3H3v9l9 9 9-9ZM7 7h.01",
  leaf: "M20 3c-15-1-19 9-11 13 7 4 12-4 11-13ZM3 21l12-12",
  sun: "M12 8a4 4 0 1 1 0 8 4 4 0 0 1 0-8Zm0-6v2m0 16v2M2 12h2m16 0h2M5 5l1 1m12 12 1 1M5 19l1-1M18 6l1-1",
  moon: "M21 13A9 9 0 0 1 11 3 9 9 0 1 0 21 13Z",
  chevron: "m6 9 6 6 6-6",
  warning: "m12 3 10 18H2L12 3Zm0 5v6m0 3h.01",
  pause: "M7 4h3v16H7zM14 4h3v16h-3z",
  sparkle: "m12 2 3 7 7 3-7 3-3 7-3-7-7-3 7-3 3-7Z",
} as const;
export type IconName = keyof typeof paths;
export function Icon({
  name,
  size = 20,
  className = "",
  style,
}: {
  name: IconName;
  size?: number;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.65"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
      style={style}
    >
      <path d={paths[name]} />
    </svg>
  );
}
export function Logo({ small = false }: { small?: boolean }) {
  return (
    <span className={`logo ${small ? "logo-small" : ""}`}>
      <svg
        width="33"
        height="34"
        viewBox="0 0 40 40"
        fill="none"
        aria-hidden="true"
      >
        <path
          d="M9 31V8l11 12L31 8v23M5 8h4m22 0h4"
          stroke="currentColor"
          strokeWidth="3.1"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d="M20 27v8"
          stroke="currentColor"
          strokeWidth="3.1"
          strokeLinecap="round"
        />
      </svg>
      <span>
        margin<span className="logo-dot">.</span>
      </span>
    </span>
  );
}
