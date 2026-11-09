// Page zoom control for the header +/- buttons.
//
// Browsers don't expose their native zoom level to JavaScript, so we emulate it
// by scaling the root font size (the site is rem-based). Unlike CSS `zoom` on
// the root element, this makes the layout reflow within the viewport instead of
// overflowing it. The steps below mirror the browser (Chrome/Edge) Ctrl +/-
// zoom ladder.
const PAGE_ZOOM_STORAGE_KEY = 'eb-page-zoom';
const PAGE_ZOOM_EXPLICIT_KEY = 'eb-page-zoom-explicit';

export const DEFAULT_PAGE_ZOOM = 1;

export const PAGE_ZOOM_LEVELS = [
  0.25, 0.33, 0.5, 0.67, 0.75, 0.8, 0.9, 1,
  1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4, 5,
];

export const getStoredPageZoom = (): number | null => {
  if (typeof window === 'undefined') return null;

  try {
    const stored = Number.parseFloat(localStorage.getItem(PAGE_ZOOM_STORAGE_KEY) ?? '');
    const explicit = localStorage.getItem(PAGE_ZOOM_EXPLICIT_KEY) === 'true';
    return Number.isFinite(stored) && stored > 0 && (explicit || stored !== DEFAULT_PAGE_ZOOM) ? stored : null;
  } catch {
    return null;
  }
};

export const applyPageZoom = (zoom: number) => {
  // `theme.scss` scales the root font size by this variable, so rem-based
  // dimensions grow/shrink and the page reflows.
  document.documentElement.style.setProperty('--eb-page-zoom', String(zoom));
  // Drop the old CSS zoom implementation in case it was set before an HMR update.
  document.documentElement.style.removeProperty('zoom');

};

export const storePageZoom = (zoom: number | null) => {
  try {
    if (zoom === null) {
      localStorage.removeItem(PAGE_ZOOM_STORAGE_KEY);
      localStorage.removeItem(PAGE_ZOOM_EXPLICIT_KEY);
    } else {
      localStorage.setItem(PAGE_ZOOM_STORAGE_KEY, String(zoom));
      localStorage.setItem(PAGE_ZOOM_EXPLICIT_KEY, 'true');
    }
  } catch {
  }
};

export const getNextPageZoom = (current: number, direction: 'in' | 'out'): number => {
  if (direction === 'in') {
    return PAGE_ZOOM_LEVELS.find((level) => level > current) ?? PAGE_ZOOM_LEVELS[PAGE_ZOOM_LEVELS.length - 1];
  }

  for (let i = PAGE_ZOOM_LEVELS.length - 1; i >= 0; i -= 1) {
    if (PAGE_ZOOM_LEVELS[i] < current) return PAGE_ZOOM_LEVELS[i];
  }
  return PAGE_ZOOM_LEVELS[0];
};
