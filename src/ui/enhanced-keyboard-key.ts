import type { ChatInputKey } from "./input-routing-types.js"

function decodeCodepoint(codepoint: number) {
  if (!Number.isInteger(codepoint) || codepoint < 0 || codepoint > 0x10ffff) return undefined
  return String.fromCodePoint(codepoint)
}

export function normalizeEnhancedKeyboardKey(rawInput: string, inkKey: ChatInputKey) {
  const kitty = rawInput.match(/^\[(\d+);(\d+)u$/)
  const modifyOtherKeys = rawInput.match(/^\[27;(\d+);(\d+)~$/)
  const modifier = Number(kitty?.[2] ?? modifyOtherKeys?.[1])
  const codepoint = Number(kitty?.[1] ?? modifyOtherKeys?.[2])
  const input = decodeCodepoint(codepoint)
  if (!input || !Number.isInteger(modifier) || modifier < 1) return { input: rawInput, key: { ...inkKey } }

  const modifierBits = modifier - 1
  const key = {
    ...inkKey,
    shift: Boolean(modifierBits & 1),
    meta: Boolean(modifierBits & 2),
    ctrl: Boolean(modifierBits & 4),
    super: Boolean(modifierBits & 8),
  }
  if (codepoint === 13) key.return = true
  if (codepoint === 27) key.escape = true
  return { input: codepoint === 13 ? "\r" : codepoint === 27 ? "" : input, key }
}
