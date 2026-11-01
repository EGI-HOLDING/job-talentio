export type FloatingPanelPosition = {
  left: number;
  width: number;
  maxHeight: number;
} & ({ top: number; bottom?: never } | { bottom: number; top?: never });

/** Keep anchored suggestion panels inside the visible viewport, including short screens. */
export function floatingPanelPosition(
  anchor: DOMRect,
  preferredMaxHeight = 320,
  preferredMaxWidth = anchor.width,
): FloatingPanelPosition | null {
  const edge = 8;
  const gap = 6;
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const width = Math.min(anchor.width, preferredMaxWidth, Math.max(0, viewportWidth - edge * 2));
  if (!width || !viewportHeight) return null;

  const left = Math.min(
    Math.max(edge, anchor.left),
    Math.max(edge, viewportWidth - edge - width),
  );
  const above = Math.max(0, anchor.top - gap - edge);
  const below = Math.max(0, viewportHeight - anchor.bottom - gap - edge);
  const openAbove = below < Math.min(preferredMaxHeight, 200) && above > below;
  const available = openAbove ? above : below;
  if (available <= 0) return null;

  const maxHeight = Math.min(preferredMaxHeight, available);
  return openAbove
    ? { left, width, maxHeight, bottom: viewportHeight - anchor.top + gap }
    : { left, width, maxHeight, top: anchor.bottom + gap };
}
