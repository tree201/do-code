import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import { importOpenCodeConfig, resolveRuntimeModelConfig } from "../src/config.js"
import { parseArgs } from "../src/cli-args.js"
import { deleteSession, exportSession, listSessions, loadSession, renameSession, searchSessions, sessionsRoot } from "../src/sessions.js"

test("production launcher uses the active Node runtime and starts the compiled CLI", async () => {
  const rootPackage = JSON.parse(await readFile(path.resolve("package.json"), "utf8")) as { bin: Record<string, string>; engines: { node: string } }
  const cliPackage = JSON.parse(await readFile(path.resolve("packages/cli/package.json"), "utf8")) as { bin: Record<string, string>; engines: { node: string }; dependencies: { ink: string } }
  assert.equal(rootPackage.bin["do-code"], "scripts/cli-entry.js")
  assert.equal(cliPackage.bin["do-code"], "scripts/cli-entry.js")
  assert.equal(rootPackage.engines.node, "^20.19.0 || >=22.12.0")
  assert.equal(cliPackage.engines.node, rootPackage.engines.node)
  assert.equal(cliPackage.dependencies.ink, "npm:@jrichman/ink@6.6.9")

  const launched = spawnSync(process.execPath, ["scripts/cli-entry.js", "--version"], {
    cwd: path.resolve("."),
    encoding: "utf8",
  })
  assert.equal(launched.status, 0, launched.stderr)
  assert.match(launched.stdout, /^0\.3\.0\s*$/)
})

test("imports OpenCode without copying its API key", async () => {
  const root=await mkdtemp(path.join(os.tmpdir(),"do-code-config-"))
  const openCode=path.join(root,"opencode.json"),doCode=path.join(root,"do-code.json")
  await writeFile(openCode,JSON.stringify({provider:{"coding-plan":{models:{"glm-5.2":{}},options:{apiKey:"secret-value",baseURL:"https://ark.example/api/coding/v3"}}}}))
  const previousOpenCode=process.env.OPENCODE_CONFIG_PATH,previousDoCode=process.env.DO_CODE_CONFIG_PATH
  process.env.OPENCODE_CONFIG_PATH=openCode;process.env.DO_CODE_CONFIG_PATH=doCode
  try{
    const imported=await importOpenCodeConfig()
    assert.equal(imported.runtime.modelId,"glm-5.2")
    assert.doesNotMatch(await readFile(doCode,"utf8"),/secret-value/)
    assert.equal((await resolveRuntimeModelConfig()).apiKey,"secret-value")
  }finally{
    if(previousOpenCode===undefined)delete process.env.OPENCODE_CONFIG_PATH;else process.env.OPENCODE_CONFIG_PATH=previousOpenCode
    if(previousDoCode===undefined)delete process.env.DO_CODE_CONFIG_PATH;else process.env.DO_CODE_CONFIG_PATH=previousDoCode
  }
})

test("lists and restores the latest project session",async()=>{
  const workspace=await mkdtemp(path.join(os.tmpdir(),"do-code-sessions-"))
  const directory=path.join(sessionsRoot(workspace),"session_new")
  await mkdir(directory,{recursive:true})
  await writeFile(path.join(directory,"session.json"),JSON.stringify({id:"session_new",workspace,model:"glm-5.2",createdAt:"2026-08-06T00:00:00.000Z",updatedAt:"2026-08-06T01:00:00.000Z"}))
  await writeFile(path.join(directory,"messages.jsonl"),`${JSON.stringify({role:"system",content:"system"})}\n${JSON.stringify({role:"user",content:"hello"})}\n`)
  assert.equal((await listSessions(workspace))[0]?.id,"session_new")
  const restored=await loadSession(workspace)
  assert.equal(restored.session.id,"session_new")
  assert.deepEqual(restored.messages.map((message)=>message.role),["system","user"])
})

test("parses continue and resume commands",()=>{
  assert.equal(parseArgs(["--continue"]).continueSession,true)
  const resume=parseArgs(["resume","session_123","-C","project"])
  assert.equal(resume.command,"resume")
  assert.equal(resume.sessionId,"session_123")
  assert.equal(resume.workspace,path.resolve("project"))
})

test("parses agent profiles, version, and update channels", () => {
  const profiled = parseArgs(["--agent", "review", "--image", "one.png", "--image", "two.jpg"])
  assert.equal(profiled.agent, "review")
  assert.deepEqual(profiled.images, ["one.png", "two.jpg"])
  assert.equal(parseArgs(["version"]).command, "version")
  const update = parseArgs(["update", "install", "preview"])
  assert.equal(update.updateAction, "install")
  assert.equal(update.updateChannel, "preview")
})

test("manages, searches, renames, exports and deletes project sessions", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "do-code-session-manage-"))
  const directory = path.join(sessionsRoot(workspace), "session_manage")
  await mkdir(directory, { recursive: true })
  await writeFile(path.join(directory, "session.json"), JSON.stringify({
    id: "session_manage", workspace, model: "glm-5.2", createdAt: "2026-08-06T00:00:00.000Z", updatedAt: "2026-08-06T01:00:00.000Z",
  }))
  await writeFile(path.join(directory, "messages.jsonl"), `${JSON.stringify({ role: "system", content: "system" })}\n${JSON.stringify({ role: "user", content: "修复登录问题" })}\n${JSON.stringify({ role: "assistant", content: "已经修复" })}\n`)
  await writeFile(path.join(directory, "events.jsonl"), `${JSON.stringify({ event: { type: "turn.completed" } })}\n`)

  assert.equal((await searchSessions(workspace, "登录"))[0]?.id, "session_manage")
  assert.equal((await listSessions(workspace))[0]?.title, "修复登录问题")
  assert.equal((await renameSession(workspace, "session_manage", "登录修复完成")).title, "登录修复完成")

  const markdown = await exportSession(workspace, "session_manage", "md")
  assert.match(await readFile(markdown, "utf8"), /## User[\s\S]*修复登录问题/)
  const json = await exportSession(workspace, "session_manage", "json")
  assert.equal(JSON.parse(await readFile(json, "utf8")).session.title, "登录修复完成")

  await deleteSession(workspace, "session_manage")
  assert.equal((await listSessions(workspace)).length, 0)
})

test("parses session management subcommands", () => {
  assert.equal(parseArgs(["sessions"]).sessionAction, "list")
  assert.equal(parseArgs(["sessions", "search", "登录", "问题"]).sessionQuery, "登录 问题")
  const rename = parseArgs(["sessions", "rename", "session_1", "新的", "名称"])
  assert.equal(rename.sessionId, "session_1")
  assert.equal(rename.sessionTitle, "新的 名称")
  const exported = parseArgs(["sessions", "export", "session_1", "json", "output.json"])
  assert.equal(exported.exportFormat, "json")
  assert.equal(exported.output, "output.json")
})

test("parses local error report commands", () => {
  assert.equal(parseArgs(["errors"]).errorAction, "list")
  const shown = parseArgs(["errors", "show", "err_20260806_12345678"])
  assert.equal(shown.errorAction, "show")
  assert.equal(shown.errorId, "err_20260806_12345678")
})
