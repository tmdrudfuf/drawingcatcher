/**
 * Low-fidelity visual direction for Milestone 1.
 * Warm off-white ground, rounded cards, coral primary CTA, green "ready" states.
 * Deliberately not a polished brand system yet.
 */
export const colors = {
  paper: '#FBF9F5',
  board: '#F3EFE6',
  card: '#FFFFFF',
  cardTint: '#FDFCF9',
  ink: '#2F2B26',
  sub: '#6F685C',
  faint: '#9A9280',
  line: '#DCD6C7',
  line2: '#E4DFD2',
  coral: '#EC8A56',
  coralInk: '#B9612F',
  coralTint: '#FDF1EA',
  green: '#4F9D6B',
  greenTint: '#EAF4EE',
  yellowTint: '#FFF6E2',
  yellowInk: '#8A6D1F',
} as const;

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;

export const radius = { sm: 10, md: 14, lg: 18, xl: 28, pill: 999 } as const;

export const font = {
  h1: 34,
  h2: 24,
  title: 19,
  body: 15,
  small: 13,
  tiny: 11,
} as const;

export const timing = {
  /** Drawing round length — hypothesis from MVP_WIREFLOW.md, not permanent. */
  roundSeconds: 30,
} as const;
