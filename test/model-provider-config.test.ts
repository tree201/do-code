import assert from "node:assert/strict"
import { mkdtemp, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import { effectiveReasoningEffort, effectiveThinkingMode, listModelPresets, loadStoredConfig, resolveRuntimeModelConfig } from "../src/config.js"

test("Qwen-style modelProviders resolve protocol, credentials and effort", async () => {
  const directory=await mkdtemp(path.join(os.tmpdir(),"do-code-provider-"))
  const configPath=path.join(directory,"config.json")
  await writeFile(configPath,JSON.stringify({version:2,defaultModel:"ark/glm-5.2",modelProviders:{ark:[{id:"glm-5.2",baseUrl:"https://ark.cn-beijing.volces.com/api/coding/v3",envKey:"TEST_ARK_KEY",supportedEfforts:["low","high"]}]},providerProtocol:{ark:"openai-compatible"}}))
  const previousPath=process.env.DO_CODE_CONFIG_PATH,previousKey=process.env.TEST_ARK_KEY
  process.env.DO_CODE_CONFIG_PATH=configPath;process.env.TEST_ARK_KEY="secret"
  try{
    const config=await loadStoredConfig(directory)
    assert.deepEqual(listModelPresets(config),["ark/glm-5.2"])
    const runtime=await resolveRuntimeModelConfig(directory,undefined,undefined,"xhigh","off")
    assert.equal(runtime.protocol,"openai-compatible")
    assert.equal(runtime.apiKey,"secret")
    assert.equal(runtime.reasoningEffort,"xhigh")
    assert.equal(runtime.effectiveReasoningEffort,"high")
    assert.equal(runtime.thinkingMode,"off")
    assert.equal(runtime.effectiveThinkingMode,"off")
    assert.equal(runtime.thinkingTransport,"reasoning-effort")
  }finally{
    if(previousPath===undefined)delete process.env.DO_CODE_CONFIG_PATH;else process.env.DO_CODE_CONFIG_PATH=previousPath
    if(previousKey===undefined)delete process.env.TEST_ARK_KEY;else process.env.TEST_ARK_KEY=previousKey
  }
})

test("Qwen-style modelProviders preserve model request and stream idle timeouts", async () => {
  const directory=await mkdtemp(path.join(os.tmpdir(),"do-code-provider-timeout-"))
  const configPath=path.join(directory,"config.json")
  await writeFile(configPath,JSON.stringify({version:2,defaultModel:"test/model",modelProviders:{test:[{id:"model",baseUrl:"https://example.com/v1",envKey:"TEST_TIMEOUT_KEY",generationConfig:{timeoutMs:90000,streamIdleTimeoutMs:45000,maxRetries:2}}]},providerProtocol:{test:"openai-compatible"}}))
  const previousPath=process.env.DO_CODE_CONFIG_PATH,previousKey=process.env.TEST_TIMEOUT_KEY
  process.env.DO_CODE_CONFIG_PATH=configPath;process.env.TEST_TIMEOUT_KEY="secret"
  try{
    const runtime=await resolveRuntimeModelConfig(directory)
    assert.equal(runtime.generationConfig?.timeoutMs,90000)
    assert.equal(runtime.generationConfig?.streamIdleTimeoutMs,45000)
    assert.equal(runtime.generationConfig?.maxRetries,2)
  }finally{
    if(previousPath===undefined)delete process.env.DO_CODE_CONFIG_PATH;else process.env.DO_CODE_CONFIG_PATH=previousPath
    if(previousKey===undefined)delete process.env.TEST_TIMEOUT_KEY;else process.env.TEST_TIMEOUT_KEY=previousKey
  }
})

test("unsupported effort maps to the nearest provider level",()=>{
  assert.equal(effectiveReasoningEffort("max",["low","medium","high"]),"high")
  assert.equal(effectiveReasoningEffort("medium",["low","high"]),"low")
})

test("thinking mode resolves independently from effort and falls back to a supported mode",()=>{
  assert.equal(effectiveThinkingMode("off",["auto","on"]),"auto")
  assert.equal(effectiveThinkingMode("on",["on","off"]),"on")
})

test("Qwen credential source reads the local Qwen settings without copying the secret", async () => {
  const directory=await mkdtemp(path.join(os.tmpdir(),"do-code-qwen-provider-"))
  const configPath=path.join(directory,"config.json"),qwenPath=path.join(directory,"qwen.json")
  await writeFile(configPath,JSON.stringify({version:2,defaultModel:"ark/glm-5.2",modelProviders:{ark:[{id:"glm-5.2",baseUrl:"https://ark.example/v3",envKey:"ARK_CODING_PLAN_API_KEY",credential:{source:"qwen"}}]},providerProtocol:{ark:"openai-compatible"}}))
  await writeFile(qwenPath,JSON.stringify({env:{ARK_CODING_PLAN_API_KEY:"qwen-secret"},modelProviders:{openai:[{id:"glm-5.2",baseUrl:"https://ark.example/v3"}]}}))
  const previousConfig=process.env.DO_CODE_CONFIG_PATH,previousQwen=process.env.QWEN_CODE_CONFIG_PATH
  process.env.DO_CODE_CONFIG_PATH=configPath;process.env.QWEN_CODE_CONFIG_PATH=qwenPath
  try{
    const runtime=await resolveRuntimeModelConfig(directory)
    assert.equal(runtime.apiKey,"qwen-secret")
    assert.equal(runtime.baseUrl,"https://ark.example/v3")
    assert.equal(runtime.modelId,"glm-5.2")
  }finally{
    if(previousConfig===undefined)delete process.env.DO_CODE_CONFIG_PATH;else process.env.DO_CODE_CONFIG_PATH=previousConfig
    if(previousQwen===undefined)delete process.env.QWEN_CODE_CONFIG_PATH;else process.env.QWEN_CODE_CONFIG_PATH=previousQwen
  }
})
