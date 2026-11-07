import { useEffect, useLayoutEffect, useRef } from "react";

type Position = { top: number; left: number };

/** Animate real rows after React commits; never delay mutations or clone content. */
export function useListMotion(itemsKey: string, presentationKey?: string, contentKey?: string) {
  const ref = useRef<HTMLDivElement>(null);
  const previous = useRef(new Map<string, Position>());
  const container = useRef<HTMLDivElement | null>(null);
  const presentation = useRef(presentationKey);
  const identity = useRef(itemsKey);
  const content = useRef(contentKey);
  const geometry = useRef<(Position & { width: number }) | undefined>(undefined);
  const animations = useRef(new Set<Animation>());

  useEffect(() => {
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const cancel = () => {
      for (const animation of animations.current) animation.cancel();
      animations.current.clear();
    };
    const change = () => {
      if (preference.matches) cancel();
    };
    preference.addEventListener("change", change);
    return () => {
      preference.removeEventListener("change", change);
      cancel();
    };
  }, []);

  useLayoutEffect(() => {
    for (const animation of animations.current) animation.cancel();
    animations.current.clear();
    const list = ref.current;
    const presentationChanged = presentation.current !== presentationKey;
    const contentOnlyChanged = identity.current === itemsKey && content.current !== contentKey;
    const rect = list?.getBoundingClientRect();
    const nextGeometry = rect ? { width: rect.width, top: rect.top + window.scrollY, left: rect.left + window.scrollX } : undefined;
    const geometryChanged = container.current === list && geometry.current !== undefined &&
      (!nextGeometry || geometry.current.width !== nextGeometry.width || geometry.current.top !== nextGeometry.top || geometry.current.left !== nextGeometry.left);
    const rebase = presentationChanged || geometryChanged || contentOnlyChanged;
    presentation.current = presentationKey;
    identity.current = itemsKey;
    content.current = contentKey;
    geometry.current = nextGeometry;
    if (container.current !== list || rebase) previous.current.clear();
    container.current = list;
    const rows = Array.from(
      list?.querySelectorAll<HTMLElement>("[data-motion-key]") || [],
    );
    // Measure every row before writing transforms to avoid repeated layouts.
    const positions = rows.map((element) => {
      const rect = element.getBoundingClientRect();
      return {
        element,
        key: element.dataset.motionKey!,
        top: rect.top + window.scrollY,
        left: rect.left + window.scrollX,
      };
    });
    const reduced = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    for (const [index, position] of positions.entries()) {
      const old = previous.current.get(position.key);
      // Presentation, responsive bounds and content-only reflow invalidate old
      // geometry. Store fresh positions without translating from stale ones.
      if (rebase || reduced || !position.element.animate) continue;
      const x = old ? old.left - position.left : 0;
      const y = old ? old.top - position.top : 5;
      if (old && Math.abs(x) < 1 && Math.abs(y) < 1) continue;
      const animation = position.element.animate(
        [
          { opacity: old ? 1 : 0, transform: `translate(${x}px, ${y}px)` },
          { opacity: 1, transform: "translate(0, 0)" },
        ],
        {
          duration: 200,
          easing: "cubic-bezier(0.2, 0, 0, 1)",
          delay: old ? 0 : Math.min(index, 5) * 12,
          fill: "backwards",
        },
      );
      animations.current.add(animation);
      animation.onfinish = animation.oncancel = () =>
        animations.current.delete(animation);
    }
    previous.current = new Map(positions.map((row) => [row.key, row]));
  }, [itemsKey, presentationKey, contentKey]);

  return ref;
}
