import assert from "node:assert/strict"
import test from "node:test"
import type { DoCodeLanguage } from "../src/config.js"
import { builtinCommandCompletions } from "../src/ui/completion.js"
import { helpText } from "../src/ui/slash-command-help.js"
import { routeSlashCommand } from "../src/ui/slash-command-router.js"

const removedCommands = [
  "/approval-mode", "/paste-image", "/remove-image", "/restore", "/trust", "/untrust", "/quit",
]

test("slash command help groups commands into aligned, scannable sections", () => {
  const help = helpText("zh")
  assert.match(help, /^常用命令\n  \/help\s+查看可用命令/m)
  assert.match(help, /\n\n模型与界面\n  \/model \[provider\/model\]\s+查看或切换模型预设/)
  assert.match(help, /\n\n计划与权限\n  \/plan \[goal\|exit\]\s+进入只读规划模式或开始制定目标计划/)
  assert.match(help, /\n\n会话与工作区\n  \/resume \[name\]\s+浏览并恢复历史会话/)
  assert.match(help, /\n\n输入快捷方式\n  @path\s+添加工作区文件到上下文/)
  assert.doesNotMatch(help, / · \/status| · Ctrl\+R/)

  for (const command of builtinCommandCompletions("zh")) {
    const matches = help.match(new RegExp(`${escapeRegex(command.description)}$`, "gm")) ?? []
    assert.equal(matches.length, 1, `${command.label} should contribute exactly one localized help entry`)
  }
})

test("removed commands are absent from builtin completion, help, and routing", () => {
  const completionLabels = builtinCommandCompletions("en").map((command) => command.label)
  for (const command of removedCommands) {
    assert.equal(completionLabels.includes(command), false, `${command} must not be offered as a builtin completion`)
    assert.doesNotMatch(helpText("en"), new RegExp(`^  ${escapeRegex(command)}(?:\\s|$)`, "m"), `${command} must not appear in help`)
    assert.deepEqual(routeSlashCommand(command), { kind: "unknown", command: command.slice(1), argument: "" })
  }
})

test("slash command help localizes every section and description", () => {
  const headings: Record<Exclude<DoCodeLanguage, "en">, string[]> = {
    zh: ["常用命令", "模型与界面", "计划与权限", "会话与工作区", "输入快捷方式"],
    ja: ["よく使うコマンド", "モデルとインターフェース", "計画と権限", "セッションとワークスペース", "入力ショートカット"],
    ko: ["자주 쓰는 명령", "모델 및 인터페이스", "계획 및 권한", "세션 및 작업 공간", "입력 단축키"],
    es: ["Comandos comunes", "Modelo e interfaz", "Planificación y permisos", "Sesiones y espacio de trabajo", "Atajos de entrada"],
    fr: ["Commandes courantes", "Modèle et interface", "Planification et autorisations", "Sessions et espace de travail", "Raccourcis de saisie"],
  }
  for (const [language, expectedHeadings] of Object.entries(headings) as Array<[Exclude<DoCodeLanguage, "en">, string[]]>) {
    const help = helpText(language)
    for (const heading of expectedHeadings) assert.match(help, new RegExp(`^${escapeRegex(heading)}$`, "m"))
    assert.doesNotMatch(help, /^(Common commands|Model and interface|Planning and permissions|Sessions and workspace|Input shortcuts)$/m)
    for (const command of builtinCommandCompletions("en")) {
      assert.doesNotMatch(help, new RegExp(`^  ${escapeRegex(command.label)}.*${escapeRegex(command.description)}$`, "m"), `${language} should not fall back to the English description for ${command.label}`)
    }
  }
})

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}
