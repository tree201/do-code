import assert from "node:assert/strict"
import test from "node:test"
import { anthropicToolSchemas, geminiToolSchemas } from "../src/model-tool-schemas.js"
import type { ToolDefinition } from "../src/protocol.js"

const tools: ToolDefinition[] = [{ type: "function", function: { name: "demo", description: "Demo", parameters: { type: "object", properties: {} } } }]

test("provider tool schemas are cached by tool array identity", () => {
  assert.equal(anthropicToolSchemas(tools), anthropicToolSchemas(tools))
  assert.equal(geminiToolSchemas(tools), geminiToolSchemas(tools))
  assert.notEqual(anthropicToolSchemas([...tools]), anthropicToolSchemas(tools))
  assert.deepEqual(anthropicToolSchemas(tools)[0], { name: "demo", description: "Demo", input_schema: tools[0]!.function.parameters })
  assert.deepEqual(geminiToolSchemas(tools)[0], { name: "demo", description: "Demo", parameters: tools[0]!.function.parameters })
})
