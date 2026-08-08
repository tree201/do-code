/**
 * Codex-style semantic terminal palette.
 *
 * Keep most text on the terminal's default foreground so the host theme can
 * maintain contrast. Color is reserved for meaning, never decoration.
 */
export const tuiTheme = {
  accent: "cyan",
  success: "green",
  danger: "red",
  warning: "#D29922",
  pending: "gray",
  brand: "magenta",
  border: "gray",
  userMessageBackground: "#2B2B2B",
  diffAddedBackground: "#173B2A",
  diffRemovedBackground: "#482321",
  diffLineNumber: "#737373",
  diffAddedMarker: "#4EC987",
  diffRemovedMarker: "#E06C68",
} as const

/** A quiet white pulse, close to Codex's thinking treatment. */
export const thinkingBreathColors = [
  "#737373",
  "#8C8C8C",
  "#B3B3B3",
  "#D9D9D9",
  "#FFFFFF",
  "#D9D9D9",
  "#B3B3B3",
  "#8C8C8C",
] as const

export const THINKING_BREATH_INTERVAL_MS = 300
