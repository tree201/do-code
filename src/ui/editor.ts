export type EditorSnapshot = { value: string; cursor: number }

export type EditorState = EditorSnapshot & {
  undoStack: EditorSnapshot[]
  redoStack: EditorSnapshot[]
}

const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" })

export function graphemes(value: string) {
  return [...segmenter.segment(value)].map((part) => part.segment)
}

export function createEditor(value = ""): EditorState {
  return { value, cursor: graphemes(value).length, undoStack: [], redoStack: [] }
}

function commit(state: EditorState, value: string, cursor: number): EditorState {
  if (value === state.value && cursor === state.cursor) return state
  return {
    value,
    cursor,
    undoStack: [...state.undoStack.slice(-99), { value: state.value, cursor: state.cursor }],
    redoStack: [],
  }
}

export function setEditorValue(state: EditorState, value: string): EditorState {
  return commit(state, value, graphemes(value).length)
}

export function replaceEditorRange(state: EditorState, start: number, end: number, replacement: string): EditorState {
  const parts = graphemes(state.value)
  const inserted = graphemes(replacement.replace(/\r\n?/g, "\n"))
  const safeStart = Math.max(0, Math.min(start, parts.length))
  const safeEnd = Math.max(safeStart, Math.min(end, parts.length))
  parts.splice(safeStart, safeEnd - safeStart, ...inserted)
  return commit(state, parts.join(""), safeStart + inserted.length)
}

export function insertEditorText(state: EditorState, text: string) {
  return replaceEditorRange(state, state.cursor, state.cursor, text)
}

export function backspaceEditor(state: EditorState) {
  return state.cursor > 0 ? replaceEditorRange(state, state.cursor - 1, state.cursor, "") : state
}

export function deleteEditor(state: EditorState) {
  return replaceEditorRange(state, state.cursor, state.cursor + 1, "")
}

export function moveEditorCursor(state: EditorState, offset: number): EditorState {
  const cursor = Math.max(0, Math.min(graphemes(state.value).length, state.cursor + offset))
  return { ...state, cursor }
}

function linePosition(parts: string[], cursor: number) {
  let lineStart = 0
  let line = 0
  for (let index = 0; index < cursor; index++) {
    if (parts[index] === "\n") {
      line++
      lineStart = index + 1
    }
  }
  let lineEnd = parts.length
  for (let index = cursor; index < parts.length; index++) {
    if (parts[index] === "\n") {
      lineEnd = index
      break
    }
  }
  return { line, lineStart, lineEnd, column: cursor - lineStart }
}

export function moveEditorHome(state: EditorState) {
  const parts = graphemes(state.value)
  return { ...state, cursor: linePosition(parts, state.cursor).lineStart }
}

export function moveEditorEnd(state: EditorState) {
  const parts = graphemes(state.value)
  return { ...state, cursor: linePosition(parts, state.cursor).lineEnd }
}

export function moveEditorVertical(state: EditorState, direction: -1 | 1): EditorState {
  const parts = graphemes(state.value)
  const current = linePosition(parts, state.cursor)
  if (direction === -1 && current.lineStart === 0) return state
  if (direction === 1 && current.lineEnd === parts.length) return state
  if (direction === -1) {
    const previousEnd = current.lineStart - 1
    let previousStart = 0
    for (let index = previousEnd - 1; index >= 0; index--) {
      if (parts[index] === "\n") {
        previousStart = index + 1
        break
      }
    }
    return { ...state, cursor: previousStart + Math.min(current.column, previousEnd - previousStart) }
  }
  const nextStart = current.lineEnd + 1
  let nextEnd = parts.length
  for (let index = nextStart; index < parts.length; index++) {
    if (parts[index] === "\n") {
      nextEnd = index
      break
    }
  }
  return { ...state, cursor: nextStart + Math.min(current.column, nextEnd - nextStart) }
}

export function undoEditor(state: EditorState): EditorState {
  const previous = state.undoStack.at(-1)
  if (!previous) return state
  return {
    ...previous,
    undoStack: state.undoStack.slice(0, -1),
    redoStack: [{ value: state.value, cursor: state.cursor }, ...state.redoStack].slice(0, 100),
  }
}

export function redoEditor(state: EditorState): EditorState {
  const next = state.redoStack[0]
  if (!next) return state
  return {
    ...next,
    undoStack: [...state.undoStack, { value: state.value, cursor: state.cursor }].slice(-100),
    redoStack: state.redoStack.slice(1),
  }
}

export function editorCursorParts(state: EditorState) {
  const parts = graphemes(state.value)
  return {
    before: parts.slice(0, state.cursor).join(""),
    cursor: parts[state.cursor] ?? " ",
    after: parts.slice(state.cursor + (parts[state.cursor] ? 1 : 0)).join(""),
  }
}
