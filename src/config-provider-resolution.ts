export function defaultModelSupportsImages(model: string): boolean | undefined {
  const normalized = model.toLowerCase().split("/").at(-1) ?? model.toLowerCase()
  if (/^(gpt-|o\d)/.test(normalized)) return true
  if (/^(claude-|qwen3\.(5|6|7)-plus|qwen3\.8-max|qwen-vl-|qwen3-vl-|qwen3\.6-35b)/.test(normalized)) return true
  if (/^(glm-4\.5v|minimax-m3|kimi-k3|kimi-k2\.)/.test(normalized)) return true
  if (/^doubao-seed(ance|ream)/.test(normalized)) return false
  if (/^doubao-seed|^doubao-.*(vision|vl)/.test(normalized)) return true
  if (/^(deepseek|glm-|minimax-|kimi-|qwen3-coder-|qwen)/.test(normalized)) return false
  if (/^doubao/.test(normalized)) return false
  return undefined
}
