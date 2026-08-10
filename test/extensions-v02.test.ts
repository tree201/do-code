import assert from "node:assert/strict"
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises"
import { createServer } from "node:http"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import { loadStoredConfig, migrateConfig, normalizeLanguage, resolveAgentProfile, resolveRuntimeModelConfig, saveLanguagePreference } from "../src/config.js"
import { expandPromptExtension, loadPromptExtensions } from "../src/extension-registry.js"
import { HookRunner } from "../src/hooks.js"
import { McpManager } from "../src/mcp.js"
import { createSandboxShellRunner, createSandboxShellSpawnSpec } from "../src/sandbox.js"

test("v2 configuration migrates v1 and merges user and project layers", async () => {
  const root=await mkdtemp(path.join(os.tmpdir(),"do-code-v02-config-"))
  const user=path.join(root,"user.json"),system=path.join(root,"missing-system.json"),project=path.join(root,"project")
  await mkdir(path.join(project,".do-code"),{recursive:true})
  await writeFile(user,JSON.stringify({version:2,defaultModel:"one/a",providers:{one:{baseUrl:"https://one.example/v1",apiKeyEnv:"ONE_KEY",models:{a:{modelId:"model-a"}}}}}))
  await writeFile(path.join(project,".do-code","config.json"),JSON.stringify({version:2,defaultModel:"two/b",providers:{two:{baseUrl:"https://two.example/v1",apiKeyEnv:"TWO_KEY",models:{b:{modelId:"model-b",contextWindow:64000}}}}}))
  const previousUser=process.env.DO_CODE_CONFIG_PATH,previousSystem=process.env.DO_CODE_SYSTEM_CONFIG_PATH,previousKey=process.env.TWO_KEY
  process.env.DO_CODE_CONFIG_PATH=user;process.env.DO_CODE_SYSTEM_CONFIG_PATH=system;process.env.TWO_KEY="secret"
  try{
    const config=await loadStoredConfig(project)
    assert.equal(config.defaultModel,"two/b")
    assert.deepEqual(config.sources,[user,path.join(project,".do-code","config.json")])
    assert.deepEqual(Object.keys(config.providers??{}).sort(),["one","two"])
    const runtime=await resolveRuntimeModelConfig(project)
    assert.equal(runtime.preset,"two/b")
    assert.equal(runtime.modelId,"model-b")
    assert.equal(runtime.apiKey,"secret")
    assert.equal(runtime.contextWindow,64000)
  }finally{
    if(previousUser===undefined)delete process.env.DO_CODE_CONFIG_PATH;else process.env.DO_CODE_CONFIG_PATH=previousUser
    if(previousSystem===undefined)delete process.env.DO_CODE_SYSTEM_CONFIG_PATH;else process.env.DO_CODE_SYSTEM_CONFIG_PATH=previousSystem
    if(previousKey===undefined)delete process.env.TWO_KEY;else process.env.TWO_KEY=previousKey
  }
})

test("sandbox network configuration supports three modes and migrates booleans", () => {
  assert.equal(migrateConfig({ version: 2, sandbox: { network: "none" } }).sandbox?.network, "none")
  assert.equal(migrateConfig({ version: 2, sandbox: { network: "local" } }).sandbox?.network, "local")
  assert.equal(migrateConfig({ version: 2, sandbox: { network: "full" } }).sandbox?.network, "full")
  assert.equal(migrateConfig({ version: 2, sandbox: { network: false } }).sandbox?.network, "none")
  assert.equal(migrateConfig({ version: 2, sandbox: { network: true } }).sandbox?.network, "full")
  assert.throws(() => migrateConfig({ version: 2, sandbox: { network: "invalid" } }), /must be none, local, or full/)
})

test("language preference validates aliases and persists in user configuration", async () => {
  const root=await mkdtemp(path.join(os.tmpdir(),"do-code-language-"))
  const file=path.join(root,"config.json")
  const previous=process.env.DO_CODE_CONFIG_PATH
  process.env.DO_CODE_CONFIG_PATH=file
  try{
    assert.equal(normalizeLanguage("中文"),"zh")
    assert.equal(normalizeLanguage("English"),"en")
    assert.equal(normalizeLanguage("Japanese"),null)
    assert.throws(()=>migrateConfig({version:2,language:"ja"}),/language must be one of: en, zh/)
    await saveLanguagePreference("zh")
    assert.equal((await loadStoredConfig()).language,"zh")
    assert.equal(JSON.parse(await readFile(file,"utf8")).language,"zh")
  }finally{if(previous===undefined)delete process.env.DO_CODE_CONFIG_PATH;else process.env.DO_CODE_CONFIG_PATH=previous}
})

test("sandbox network setting caps each command's requested capability", () => {
  const none = createSandboxShellSpawnSpec(process.cwd(), { type: "seatbelt", network: "none" }, "npm install", "full")
  const local = createSandboxShellSpawnSpec(process.cwd(), { type: "seatbelt", network: "local" }, "npm install", "full")
  const leastPrivilege = createSandboxShellSpawnSpec(process.cwd(), { type: "seatbelt", network: "full" }, "npm test", "none")
  assert.doesNotMatch(none.args[1] ?? "", /allow network-(?:outbound|bind|inbound)/)
  assert.match(local.args[1] ?? "", /allow network-bind \(local ip "localhost:\*"\)/)
  assert.doesNotMatch(local.args[1] ?? "", /\(allow network-outbound\)/)
  assert.doesNotMatch(leastPrivilege.args[1] ?? "", /allow network-(?:outbound|bind|inbound)/)
})

test("agent profiles validate and resolve model, permissions, instructions, and tools", () => {
  const config = migrateConfig({ version: 2, defaultAgent: "review", agents: { review: { model: "ark/glm-5.2", approvalMode: "ask", maxSteps: 12, instructions: "Review carefully", tools: { allow: ["read_file", "search"], deny: ["shell"] } } } })
  assert.deepEqual(resolveAgentProfile(config), { name: "review", model: "ark/glm-5.2", approvalMode: "ask", maxSteps: 12, instructions: "Review carefully", tools: { allow: ["read_file", "search"], deny: ["shell"] } })
  assert.throws(() => resolveAgentProfile(config, "missing"), /Unknown agent profile/)
})

test("project commands override user commands and skills expand arguments",async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),"do-code-v02-ext-")),workspace=path.join(root,"repo")
  const previousHome=process.env.HOME
  process.env.HOME=path.join(root,"home")
  try{
    const userCommand=path.join(process.env.HOME,".config","do-code","commands")
    const projectCommand=path.join(workspace,".do-code","commands")
    const skill=path.join(workspace,".do-code","skills","review")
    await mkdir(userCommand,{recursive:true});await mkdir(projectCommand,{recursive:true});await mkdir(skill,{recursive:true})
    await writeFile(path.join(userCommand,"fix.md"),"user $ARGUMENTS")
    await writeFile(path.join(projectCommand,"fix.md"),"---\ndescription: project fix\n---\nproject $ARGUMENTS")
    await writeFile(path.join(skill,"SKILL.md"),"---\nname: audit\ndescription: audit code\n---\nInspect carefully. $ARGUMENTS")
    const extensions=await loadPromptExtensions(workspace)
    const fix=extensions.find((item)=>item.name==="fix")!,audit=extensions.find((item)=>item.name==="audit")!
    assert.equal(fix.source,"project")
    assert.equal(expandPromptExtension(fix,"login"),"project login")
    assert.equal(expandPromptExtension(audit,"src"),"Inspect carefully. src")
  }finally{if(previousHome===undefined)delete process.env.HOME;else process.env.HOME=previousHome}
})

test("hooks receive JSON payloads and local sandbox streams command output",async()=>{
  const workspace=await mkdtemp(path.join(os.tmpdir(),"do-code-v02-hooks-"))
  const runner=new HookRunner(workspace,{beforeTool:["node -e \"process.stdin.pipe(process.stdout)\""]})
  assert.match(await runner.context("beforeTool",{name:"read_file"}),/read_file/)
  let streamed=""
  const result=await createSandboxShellRunner(workspace,{type:"local"})("printf sandbox-ok",5000,(chunk)=>{streamed+=chunk})
  assert.equal(result.ok,true)
  assert.equal(result.output,"sandbox-ok")
  assert.equal(streamed,"sandbox-ok")
})

test("macOS local network sandbox permits loopback listeners but blocks public outbound connections", { skip: process.platform !== "darwin" }, async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "do-code-local-network-"))
  const runner = createSandboxShellRunner(workspace, { type: "seatbelt" })
  const listen = await runner(`node -e "const s=require('node:net').createServer();s.on('error',e=>{console.error(e.code);process.exit(2)});s.listen(0,'127.0.0.1',()=>{console.log('LISTEN_OK');s.close()})"`, 5_000, undefined, undefined, "local")
  assert.equal(listen.ok, true)
  assert.equal(listen.output, "LISTEN_OK")

  const outbound = await runner(`node -e "const s=require('node:net').connect(443,'1.1.1.1');s.on('connect',()=>{console.log('OUTBOUND_OK');s.destroy()});s.on('error',e=>{console.error(e.code);process.exit(2)})"`, 5_000, undefined, undefined, "local")
  assert.equal(outbound.ok, false)
  assert.match(outbound.output, /EPERM/)
})

test("MCP stdio servers are discovered as namespaced tools",async()=>{
  const workspace=await mkdtemp(path.join(os.tmpdir(),"do-code-v02-mcp-"))
  const server=path.join(workspace,"server.mjs")
  await writeFile(server,`import readline from "node:readline";
const lines=readline.createInterface({input:process.stdin});
lines.on("line",line=>{const request=JSON.parse(line);if(request.id===undefined)return;
let result={};if(request.method==="tools/list")result={tools:[{name:"echo",description:"echo",inputSchema:{type:"object",properties:{value:{type:"string"}},required:["value"],additionalProperties:false}}]};
if(request.method==="tools/call")result={content:[{type:"text",text:String(request.params.arguments.value)}]};
process.stdout.write(JSON.stringify({jsonrpc:"2.0",id:request.id,result})+"\\n")});`)
  const manager=new McpManager(workspace,{demo:{command:process.execPath,args:[server]}})
  try{
    const tools=await manager.load()
    assert.equal(tools[0]?.definition.function.name,"mcp__demo__echo")
    assert.deepEqual(await tools[0]!.execute({value:"hello"},{workspace,approveShell:async()=>false}),{ok:true,output:"hello"})
  }finally{manager.close()}
  assert.equal((await readFile(server,"utf8")).includes("tools/list"),true)
})

test("MCP HTTP servers expose tools and resources", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "do-code-v03-mcp-http-"))
  const server = createServer(async (request, response) => {
    let body = ""
    for await (const chunk of request) body += chunk.toString()
    const rpc = JSON.parse(body) as { id?: number; method: string; params?: Record<string, unknown> }
    response.setHeader("content-type", "application/json")
    response.setHeader("mcp-session-id", "test-session")
    if (rpc.id === undefined) { response.statusCode = 202; response.end(); return }
    const result = rpc.method === "tools/list"
      ? { tools: [{ name: "echo", inputSchema: { type: "object", properties: { value: { type: "string" } }, additionalProperties: false } }] }
      : rpc.method === "tools/call"
        ? { content: [{ type: "text", text: String((rpc.params?.arguments as Record<string, unknown>)?.value) }] }
        : rpc.method === "resources/list"
          ? { resources: [{ uri: "docs://guide", name: "Guide", mimeType: "text/plain" }] }
          : rpc.method === "resources/read"
            ? { contents: [{ uri: "docs://guide", mimeType: "text/plain", text: "Resource body" }] }
            : {}
    response.end(JSON.stringify({ jsonrpc: "2.0", id: rpc.id, result }))
  })
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  const address = server.address()
  assert.ok(address && typeof address === "object")
  const manager = new McpManager(workspace, { remote: { url: `http://127.0.0.1:${address.port}/mcp`, headers: { authorization: "{env:MCP_TEST_TOKEN}" } } })
  try {
    const tools = await manager.load()
    assert.deepEqual(tools.map((tool) => tool.definition.function.name), ["mcp__remote__echo", "mcp__remote__list_resources", "mcp__remote__read_resource"])
    assert.deepEqual(await tools[0]!.execute({ value: "hello-http" }, { workspace, approveShell: async () => false }), { ok: true, output: "hello-http" })
    assert.match((await tools[1]!.execute({}, { workspace, approveShell: async () => false })).output, /docs:\/\/guide/)
    assert.equal((await tools[2]!.execute({ uri: "docs://guide" }, { workspace, approveShell: async () => false })).output, "Resource body")
  } finally {
    manager.close()
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  }
})

test("MCP servers initialize concurrently while preserving configuration order", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "do-code-v03-mcp-parallel-"))
  const initializing = new Set<string>()
  const pending: Array<() => void> = []
  const server = createServer(async (request, response) => {
    let body = ""
    for await (const chunk of request) body += chunk.toString()
    const rpc = JSON.parse(body) as { id?: number; method: string }
    response.setHeader("content-type", "application/json")
    if (rpc.id === undefined) { response.statusCode = 202; response.end(); return }
    const name = request.url?.includes("second") ? "second" : "first"
    if (rpc.method === "initialize") {
      initializing.add(name)
      pending.push(() => response.end(JSON.stringify({ jsonrpc: "2.0", id: rpc.id, result: {} })))
      if (initializing.size === 2) pending.splice(0).forEach((finish) => finish())
      return
    }
    const result = rpc.method === "tools/list" ? { tools: [{ name: "echo", inputSchema: { type: "object", properties: {} } }] } : { resources: [] }
    response.end(JSON.stringify({ jsonrpc: "2.0", id: rpc.id, result }))
  })
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  const address = server.address()
  assert.ok(address && typeof address === "object")
  const base = `http://127.0.0.1:${address.port}`
  const manager = new McpManager(workspace, { first: { url: `${base}/first` }, second: { url: `${base}/second` } })
  try {
    const tools = await manager.load()
    assert.deepEqual([...initializing], ["first", "second"])
    assert.deepEqual(tools.map((tool) => tool.definition.function.name), ["mcp__first__echo", "mcp__second__echo"])
  } finally {
    manager.close()
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  }
})
