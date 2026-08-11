import type { ChatInputKey } from "./input-routing-types.js"

function decodeCodepoint(codepoint: number) {
  if (!Number.isInteger(codepoint) || codepoint < 0 || codepoint > 0x10ffff) return undefined
  return String.fromCodePoint(codepoint)
}

export function normalizeEnhancedKeyboardKey(rawInput: string, inkKey: ChatInputKey) {
  if (rawInput === "\u001b") return { input: "", key: { ...inkKey, escape: true } }
  const controlCode = rawInput.length === 1 ? rawInput.charCodeAt(0) : 0
  if (controlCode >= 1 && controlCode <= 26 && ![9, 13].includes(controlCode)) {
    return { input: String.fromCharCode(96 + controlCode), key: { ...inkKey, ctrl: true } }
  }
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
  if (codepoint === 9) key.tab = true
  if (codepoint === 13) key.return = true
  if (codepoint === 27) key.escape = true
  return { input: codepoint === 9 || codepoint === 13 || codepoint === 27 ? codepoint === 13 ? "\r" : "" : input, key }
}
