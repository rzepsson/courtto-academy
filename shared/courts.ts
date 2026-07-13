// Shared, product-neutral court/table domain: geometry specs (the white-line
// patterns), surfaces, colours, and validators. Imported by BOTH the server
// (court create/update validation) and the client (the builder form + the SVG
// diagram renderer), so the two can never disagree on what a valid court is or
// how a discipline is drawn.
//
// Keep this free of Nuxt/Node imports — it must load in any context (like
// shared/org-profile.ts and shared/regional.ts). This file belongs to the
// facility core, NOT to Academy: the same court is booked by the future Courtto
// marketplace, so nothing here may reference lessons/coaches/students.

import { SPORTS, type Sport } from './org-profile'

// Whether a discipline is played on a court or on a table — drives the unit
// noun everywhere (courts.unit.<unit>) and a couple of rendering choices.
export type CourtUnit = 'court' | 'table'

// Where the court physically sits. Orthogonal to surface: an outdoor clay court
// and an indoor clay court are both valid. `covered` = roofed but open-sided.
export const COURT_ENVIRONMENTS = ['indoor', 'outdoor', 'covered'] as const
export type CourtEnvironment = (typeof COURT_ENVIRONMENTS)[number]

// A single straight line marking, in metres, in the canonical portrait frame:
// origin (0,0) at the playing area's top-left, X along the width, Y along the
// length. The renderer scales metres → pixels uniformly, so real proportions
// (and thus each discipline's recognisable shape) are preserved.
export interface CourtLine {
  x1: number
  y1: number
  x2: number
  y2: number
}

// The geometry of one discipline. The playing-area boundary rectangle
// (0,0)–(width,length) and the net (at length/2 when `hasNet`) are drawn by the
// renderer from these dimensions; `lines` holds only the interior markings, so
// the line PATTERN is derived from the sport and never stored on a court row.
export interface CourtSpec {
  unit: CourtUnit
  enclosed: boolean // walled disciplines (padel/squash/racquetball) — drawn with an outer wall frame
  hasNet: boolean
  width: number // metres, short axis (X)
  length: number // metres, long axis (Y)
  lines: CourtLine[]
}

const line = (x1: number, y1: number, x2: number, y2: number): CourtLine => ({ x1, y1, x2, y2 })

// Real court/table dimensions and markings per discipline. Measurements follow
// the official specs closely enough to render an unmistakable diagram; they are
// not intended as survey data. Extend as new sports are added to SPORTS.
export const COURT_SPECS: Record<Sport, CourtSpec> = {
  // Doubles court; singles sidelines inset 1.37 m, service lines 6.40 m from the net.
  tennis: {
    unit: 'court', enclosed: false, hasNet: true, width: 10.97, length: 23.77,
    lines: [
      line(1.37, 0, 1.37, 23.77), // singles sideline (left)
      line(9.60, 0, 9.60, 23.77), // singles sideline (right)
      line(1.37, 5.485, 9.60, 5.485), // service line (near)
      line(1.37, 18.285, 9.60, 18.285), // service line (far)
      line(5.485, 5.485, 5.485, 18.285) // centre service line
    ]
  },
  // Enclosed 20×10; service lines 3 m from the net, centre line between them.
  padel: {
    unit: 'court', enclosed: true, hasNet: true, width: 10, length: 20,
    lines: [
      line(0, 7, 10, 7),
      line(0, 13, 10, 13),
      line(5, 7, 5, 13)
    ]
  },
  // Enclosed, no net; front wall is the top edge. Short line + half-court line
  // and two service boxes toward the back.
  squash: {
    unit: 'court', enclosed: true, hasNet: false, width: 6.4, length: 9.75,
    lines: [
      line(0, 5.49, 6.4, 5.49), // short line
      line(3.2, 5.49, 3.2, 9.75), // half-court line
      line(1.6, 5.49, 1.6, 7.09), line(0, 7.09, 1.6, 7.09), // left service box
      line(4.8, 5.49, 4.8, 7.09), line(4.8, 7.09, 6.4, 7.09) // right service box
    ]
  },
  // Singles sidelines inset 0.46 m; short service lines 1.98 m from the net;
  // doubles long-service lines 0.76 m from the back; centre line splits the
  // service courts (not through the net area).
  badminton: {
    unit: 'court', enclosed: false, hasNet: true, width: 6.1, length: 13.4,
    lines: [
      line(0.46, 0, 0.46, 13.4), line(5.64, 0, 5.64, 13.4), // singles sidelines
      line(0, 4.72, 6.1, 4.72), line(0, 8.68, 6.1, 8.68), // short service lines
      line(0, 0.76, 6.1, 0.76), line(0, 12.64, 6.1, 12.64), // long service lines
      line(3.05, 0, 3.05, 4.72), line(3.05, 8.68, 3.05, 13.4) // centre line
    ]
  },
  // Non-volley zone ("kitchen") 2.13 m each side of the net; centre line in the
  // service areas only (never crosses the kitchen).
  pickleball: {
    unit: 'court', enclosed: false, hasNet: true, width: 6.1, length: 13.41,
    lines: [
      line(0, 4.575, 6.1, 4.575), line(0, 8.835, 6.1, 8.835), // kitchen lines
      line(3.05, 0, 3.05, 4.575), line(3.05, 8.835, 3.05, 13.41) // centre lines
    ]
  },
  // Just a net across the sand — no service markings.
  beachTennis: {
    unit: 'court', enclosed: false, hasNet: true, width: 8, length: 16,
    lines: []
  },
  // Enclosed, no net; short line at centre, service line 1.52 m in front, two
  // service boxes between them.
  racquetball: {
    unit: 'court', enclosed: true, hasNet: false, width: 6.1, length: 12.2,
    lines: [
      line(0, 4.57, 6.1, 4.57), // service line
      line(0, 6.1, 6.1, 6.1), // short line
      line(1.25, 4.57, 1.25, 6.1), line(4.85, 4.57, 4.85, 6.1) // service box dividers
    ]
  },
  // A table, not a court: net across the middle, centre line down the length
  // (used for doubles).
  tableTennis: {
    unit: 'table', enclosed: false, hasNet: true, width: 1.525, length: 2.74,
    lines: [
      line(0.7625, 0, 0.7625, 2.74)
    ]
  }
}

export function courtSpec(sport: Sport): CourtSpec {
  return COURT_SPECS[sport]
}

export function courtUnit(sport: Sport): CourtUnit {
  return COURT_SPECS[sport].unit
}

// Surface options per discipline. Table tennis has no surface concept (the
// table itself is the surface), so its list is empty and the form hides the
// field. Values are stable machine keys localised via courts.surfaces.<key>.
export const SURFACES_BY_SPORT: Record<Sport, readonly string[]> = {
  tennis: ['clay', 'hard', 'grass', 'carpet', 'artificialGrass'],
  padel: ['artificialGrass', 'concrete', 'porous'],
  squash: ['wood', 'synthetic'],
  badminton: ['synthetic', 'wood', 'acrylic'],
  pickleball: ['hard', 'acrylic', 'artificialGrass'],
  beachTennis: ['sand'],
  racquetball: ['wood', 'synthetic'],
  tableTennis: []
}

// Every distinct surface key across disciplines — the set the i18n layer must
// provide labels for, and the union the validators accept before the
// per-sport check narrows it.
export const COURT_SURFACES = [
  ...new Set(Object.values(SURFACES_BY_SPORT).flat())
] as const

// A tasteful preset palette for the surface colour picker; admins can also
// enter a custom hex. Kept brand-neutral and readable under white lines.
export const COURT_COLOR_PRESETS = [
  '#2f6db5', // court blue
  '#1f6f54', // court green
  '#a8432f', // clay
  '#b8823c', // wood / tan
  '#d8c08a', // sand
  '#5a4b8a', // violet
  '#3f4a57', // slate
  '#2b2f36' // graphite
] as const

// The most representative surface colour per discipline — seeds the picker so a
// fresh court already looks right before the admin touches anything.
export const DEFAULT_SURFACE_COLOR: Record<Sport, string> = {
  tennis: '#2f6db5',
  padel: '#1f6f54',
  squash: '#b8823c',
  badminton: '#1f6f54',
  pickleball: '#2f6db5',
  beachTennis: '#d8c08a',
  racquetball: '#b8823c',
  tableTennis: '#123a7a'
}

export const DEFAULT_LINE_COLOR = '#ffffff'

// Max stored length per free-text field — enforced on both sides so the DB
// never receives oversized input and the form can flag it first.
export const COURT_LIMITS = {
  name: 60,
  notes: 500,
  zone: 60
} as const

export function isCourtSport(value: string): value is Sport {
  return (SPORTS as readonly string[]).includes(value)
}

export function isCourtEnvironment(value: string): value is CourtEnvironment {
  return (COURT_ENVIRONMENTS as readonly string[]).includes(value)
}

// Whether a surface is valid for a given discipline. Table tennis (empty list)
// accepts no surface, so callers should omit the field rather than send one.
export function isValidSurfaceFor(sport: Sport, surface: string): boolean {
  return SURFACES_BY_SPORT[sport].includes(surface)
}

// A 6-digit hex colour (#rrggbb). Deliberately strict — the picker only ever
// emits this form, and it's what the SVG fill expects.
export function isHexColor(value: string): boolean {
  return /^#[0-9a-fA-F]{6}$/.test(value)
}
