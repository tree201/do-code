import assert from "node:assert/strict"
import { mkdtemp, readFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import { loadStoredConfig, resolveRuntimeModelConfig } from "../src/config.js"
import { buildProviderInstall, installProvider } from "../src/provider-setup.js"

test("Qwen-style provider setup expands a built-in provider into model entries",()=>{
  const plan=buildProviderInstall({providerId:"ark-coding-plan",apiKey:"secret",modelIds:["glm-5.2","kimi-k2.6"]})
  assert.equal(plan.baseUrl,"https://ark.cn-beijing.volces.com/api/coding/v3")
  assert.equal(plan.envKey,"ARK_CODING_PLAN_API_KEY")
  assert.deepEqual(plan.models.map(model=>model.id),["glm-5.2","kimi-k2.6"])
  assert.equal(plan.models[0]?.thinkingTransport,"reasoning-effort")
})

test("provider install stores the secret locally and produces a usable runtime config",async()=>{
  const directory=await mkdtemp(path.join(os.tmpdir(),"do-code-provider-install-"))
  const configPath=path.join(directory,"config.json")
  const previous=process.env.DO_CODE_CONFIG_PATH
  process.env.DO_CODE_CONFIG_PATH=configPath
  try{
    const installed=await installProvider({providerId:"minimax",regionId:"china",apiKey:"local-secret",modelIds:["MiniMax-M2.7"]})
    assert.equal(installed.defaultModel,"minimax/MiniMax-M2.7")
    const raw=JSON.parse(await readFile(configPath,"utf8")) as {env:Record<string,string>}
    assert.equal(raw.env.MINIMAX_API_KEY,"local-secret")
    const config=await loadStoredConfig(directory)
    const runtime=await resolveRuntimeModelConfig(directory)
    assert.equal(runtime.apiKey,"local-secret")
    assert.equal(runtime.baseUrl,"https://api.minimaxi.com/v1")
    assert.equal(config.sources.includes(configPath),true)
  }finally{if(previous===undefined)delete process.env.DO_CODE_CONFIG_PATH;else process.env.DO_CODE_CONFIG_PATH=previous}
})

test("shell environment has precedence over the locally stored provider key",async()=>{
  const directory=await mkdtemp(path.join(os.tmpdir(),"do-code-provider-env-"))
  const configPath=path.join(directory,"config.json")
  const previousPath=process.env.DO_CODE_CONFIG_PATH,previousKey=process.env.DEEPSEEK_API_KEY
  process.env.DO_CODE_CONFIG_PATH=configPath
  try{
    await installProvider({providerId:"deepseek",apiKey:"stored-secret",modelIds:["deepseek-v4-pro"]})
    process.env.DEEPSEEK_API_KEY="shell-secret"
    assert.equal((await resolveRuntimeModelConfig(directory)).apiKey,"shell-secret")
  }finally{
    if(previousPath===undefined)delete process.env.DO_CODE_CONFIG_PATH;else process.env.DO_CODE_CONFIG_PATH=previousPath
    if(previousKey===undefined)delete process.env.DEEPSEEK_API_KEY;else process.env.DEEPSEEK_API_KEY=previousKey
  }
})
