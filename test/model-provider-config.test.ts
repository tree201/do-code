import assert from "node:assert/strict"
import { mkdtemp, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import { defaultModelSupportsImages, effectiveReasoningEffort, effectiveThinkingMode, listModelPresets, loadStoredConfig, rememberRecentModel, resolveRuntimeModelConfig } from "../src/config.js"

test("model provider entries resolve protocol, credentials and effort", async () => {
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
     assert.equal(runtime.supportsImages,false)
  }finally{
    if(previousPath===undefined)delete process.env.DO_CODE_CONFIG_PATH;else process.env.DO_CODE_CONFIG_PATH=previousPath
    if(previousKey===undefined)delete process.env.TEST_ARK_KEY;else process.env.TEST_ARK_KEY=previousKey
  }
})

test("new sessions resolve the persisted default reasoning effort", async () => {
  const directory=await mkdtemp(path.join(os.tmpdir(),"do-code-provider-default-effort-"))
  const configPath=path.join(directory,"config.json")
  await writeFile(configPath,JSON.stringify({version:2,defaultModel:"test/model",defaultReasoningEffort:"high",modelProviders:{test:[{id:"model",baseUrl:"https://example.com/v1",envKey:"TEST_DEFAULT_EFFORT_KEY",supportedEfforts:["low","medium","high"]}]},providerProtocol:{test:"openai-compatible"}}))
  const previousPath=process.env.DO_CODE_CONFIG_PATH,previousKey=process.env.TEST_DEFAULT_EFFORT_KEY
  process.env.DO_CODE_CONFIG_PATH=configPath;process.env.TEST_DEFAULT_EFFORT_KEY="secret"
  try{
    const runtime=await resolveRuntimeModelConfig(directory)
    assert.equal(runtime.reasoningEffort,"high")
    assert.equal(runtime.effectiveReasoningEffort,"high")
  }finally{
    if(previousPath===undefined)delete process.env.DO_CODE_CONFIG_PATH;else process.env.DO_CODE_CONFIG_PATH=previousPath
    if(previousKey===undefined)delete process.env.TEST_DEFAULT_EFFORT_KEY;else process.env.TEST_DEFAULT_EFFORT_KEY=previousKey
  }
})

test("model provider entries preserve explicit image capability", async () => {
  const directory=await mkdtemp(path.join(os.tmpdir(),"do-code-provider-images-"))
  const configPath=path.join(directory,"config.json")
  await writeFile(configPath,JSON.stringify({version:2,defaultModel:"test/vision",modelProviders:{test:[{id:"vision",baseUrl:"https://example.com/v1",envKey:"TEST_IMAGE_KEY",supportsImages:true}]},providerProtocol:{test:"openai-compatible"}}))
  const previousPath=process.env.DO_CODE_CONFIG_PATH,previousKey=process.env.TEST_IMAGE_KEY
  process.env.DO_CODE_CONFIG_PATH=configPath;process.env.TEST_IMAGE_KEY="secret"
  try{
    assert.equal((await resolveRuntimeModelConfig(directory)).supportsImages,true)
  }finally{
    if(previousPath===undefined)delete process.env.DO_CODE_CONFIG_PATH;else process.env.DO_CODE_CONFIG_PATH=previousPath
    if(previousKey===undefined)delete process.env.TEST_IMAGE_KEY;else process.env.TEST_IMAGE_KEY=previousKey
  }
})

test("model provider entries preserve explicit image rejection", async () => {
  const directory=await mkdtemp(path.join(os.tmpdir(),"do-code-provider-text-only-"))
  const configPath=path.join(directory,"config.json")
  await writeFile(configPath,JSON.stringify({version:2,defaultModel:"test/text",modelProviders:{test:[{id:"text",baseUrl:"https://example.com/v1",envKey:"TEST_TEXT_KEY",supportsImages:false}]},providerProtocol:{test:"openai-compatible"}}))
  const previousPath=process.env.DO_CODE_CONFIG_PATH,previousKey=process.env.TEST_TEXT_KEY
  process.env.DO_CODE_CONFIG_PATH=configPath;process.env.TEST_TEXT_KEY="secret"
  try{
    assert.equal((await resolveRuntimeModelConfig(directory)).supportsImages,false)
  }finally{
    if(previousPath===undefined)delete process.env.DO_CODE_CONFIG_PATH;else process.env.DO_CODE_CONFIG_PATH=previousPath
    if(previousKey===undefined)delete process.env.TEST_TEXT_KEY;else process.env.TEST_TEXT_KEY=previousKey
  }
})

test("model image capability defaults follow known model families", () => {
  assert.equal(defaultModelSupportsImages("gpt-5.6-sol"),true)
  assert.equal(defaultModelSupportsImages("OpenAI/GPT-5.6-SOL"),true)
  assert.equal(defaultModelSupportsImages("qwen3.8-max"),true)
  assert.equal(defaultModelSupportsImages("qwen3.7-max"),false)
  assert.equal(defaultModelSupportsImages("deepseek-v4-pro"),false)
  assert.equal(defaultModelSupportsImages("unknown-proxy-model"),undefined)
  assert.equal(defaultModelSupportsImages("doubao-seedream-4"),false)
})

test("model provider entries preserve request and stream idle timeouts", async () => {
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

test("OpenCode-style model selection prefers explicit config, then recent, then provider order", async () => {
  const directory=await mkdtemp(path.join(os.tmpdir(),"do-code-recent-model-"))
  const configPath=path.join(directory,"config.json"),statePath=path.join(directory,"model.json")
  const base={version:2,modelProviders:{test:[{id:"first",baseUrl:"https://example.com/v1",envKey:"TEST_RECENT_KEY"},{id:"recent",baseUrl:"https://example.com/v1",envKey:"TEST_RECENT_KEY"}]},providerProtocol:{test:"openai-compatible"}}
  await writeFile(configPath,JSON.stringify(base))
  const previousConfig=process.env.DO_CODE_CONFIG_PATH,previousState=process.env.DO_CODE_MODEL_STATE_PATH,previousKey=process.env.TEST_RECENT_KEY
  process.env.DO_CODE_CONFIG_PATH=configPath;process.env.DO_CODE_MODEL_STATE_PATH=statePath;process.env.TEST_RECENT_KEY="secret"
  try{
    assert.equal((await resolveRuntimeModelConfig(directory)).preset,"test/first")
    await rememberRecentModel({providerID:"test",modelID:"recent"})
    assert.equal((await resolveRuntimeModelConfig(directory)).preset,"test/recent")
    await writeFile(configPath,JSON.stringify({...base,defaultModel:"test/first"}))
    assert.equal((await resolveRuntimeModelConfig(directory)).preset,"test/first")
    assert.equal((await resolveRuntimeModelConfig(directory,"test/recent")).preset,"test/recent")
  }finally{
    if(previousConfig===undefined)delete process.env.DO_CODE_CONFIG_PATH;else process.env.DO_CODE_CONFIG_PATH=previousConfig
    if(previousState===undefined)delete process.env.DO_CODE_MODEL_STATE_PATH;else process.env.DO_CODE_MODEL_STATE_PATH=previousState
    if(previousKey===undefined)delete process.env.TEST_RECENT_KEY;else process.env.TEST_RECENT_KEY=previousKey
  }
})
