import path from "node:path"
import type { DoCodeLanguage } from "./config-contracts.js"
import { normalizeLanguage } from "./config-language.js"
import type { ApprovalMode } from "./policy.js"
import { DEFAULT_MAX_TURNS } from "./turn-limits.js"
import { t } from "./ui/i18n.js"

export class CliArgumentError extends Error {
  readonly kind = "argument"
}

function argumentError(language: DoCodeLanguage, value: string, values?: Record<string, string | number>): never {
  throw new CliArgumentError(t(language, value, values))
}

function requestedLanguage(input: string[]): { index: number, language?: DoCodeLanguage } {
  const index = input.findIndex((argument) => argument === "--language")
  if (index < 0) return { index }
  const language = normalizeLanguage(input[index + 1] ?? "")
  if (!language) argumentError("en", "Unsupported language: {language}", { language: input[index + 1] ?? "" })
  return { index, language }
}

export type Args = {
  command: "chat" | "run" | "auth" | "config" | "doctor" | "sessions" | "resume" | "errors" | "extensions" | "agents" | "acp" | "worktrees" | "version" | "update"
  task?: string
  taskFile?: string
  workspace: string
  artifactDirectory?: string
  yes: boolean
  approvalMode: ApprovalMode
  json: boolean
  outputFormat: "text" | "json" | "stream-json"
  timeoutSeconds: number
  maxSteps: number
  continueSession: boolean
  sessionId?: string
  sessionAction?: "list" | "search" | "delete" | "rename" | "export"
  sessionQuery?: string
  sessionTitle?: string
  exportFormat?: "md" | "json"
  output?: string
  configAction?: "show" | "setup"
  errorAction?: "list" | "show"
  errorId?: string
  model?: string
  provider?: string
  worktree?: string
  agent?: string
  images?: string[]
  language?: DoCodeLanguage
  updateAction?: "check" | "install"
  updateChannel?: "stable" | "preview"
}

export function usage(language: DoCodeLanguage = "en") {
  const translate = (value: string, values?: Record<string, string | number>) => t(language, value, values)
  return `${translate("Usage:")}
  do-code [options]                    ${translate("Start the interactive coding agent")}
  do-code --continue [options]         ${translate("Continue the latest project session")}
  do-code resume [session-id]          ${translate("Resume a session or the latest session")}
  do-code sessions [list]              ${translate("List project sessions")}
  do-code sessions search <query>      ${translate("Search sessions")}
  do-code sessions rename <id> <name>  ${translate("Rename a session")}
  do-code sessions delete <id>         ${translate("Delete a session")}
  do-code sessions export <id> [md|json] [output]
  do-code run [options] "task"         ${translate("Run one task and exit")}
  echo "task" | do-code                ${translate("Run a headless task from stdin")}
  do-code auth                         ${translate("Configure a model with the guided setup")}
  do-code config setup                 ${translate("Same guided model setup")}
  do-code config [show]                ${translate("Show model configuration (secrets hidden)")}
  do-code doctor                       ${translate("Check the model, workspace, and local tools")}
  do-code errors [list]                ${translate("List recent error reports")}
  do-code errors show <error-id>       ${translate("Show a bad case and reproduction context")}
  do-code extensions                   ${translate("Show commands, skills, and MCP extensions")}
  do-code agents                       ${translate("List configured agent profiles")}
  do-code version                      ${translate("Show the installed version")}
  do-code update [check|install] [stable|preview]
  do-code acp                          ${translate("Start the ACP server over stdin/stdout")}
  do-code worktrees                    ${translate("List do-code worktrees")}

${translate("Options:")}
  -C, --cwd <path>       ${translate("Working directory (default: current directory)")}
  -y, --yes              ${translate("Use full-access mode (no ordinary approval prompts)")}
  --approval-mode <mode> ask | auto | full-access
  --continue             ${translate("Continue the latest session")}
  --task-file <path>     ${translate("Read the task from a UTF-8 file")}
  --artifact-dir <path>  ${translate("Set the trace, patch, and result directory")}
  --json                 ${translate("Output JSON from do-code run")}
  --output-format <fmt>  text | json | stream-json
  --max-steps <number>   ${translate("Maximum model turns per task (default: {count})", { count: DEFAULT_MAX_TURNS })}
  --timeout <seconds>    ${translate("Total runtime budget (default: 600)")}
  --model <preset>       ${translate("Select a provider/model preset")}
  --provider <name>      ${translate("Select a provider with a model name")}
  --agent <name>         ${translate("Use a configured agent profile")}
  --image <path>         ${translate("Attach a workspace image (repeatable)")}
  --worktree[=name]      ${translate("Run in an isolated Git worktree")}
  --language <locale>    ${translate("Set the interface language for this command")}
  -h, --help             ${translate("Show help")}
  -v, --version          ${translate("Show version")}

${translate("Model configuration priority:")}
  system < user < project < environment < --provider/--model`
}

export function parseArgs(input: string[]): Args {
  const requested = requestedLanguage(input)
  const language = requested.language
  const displayLanguage = language ?? "en"
  let argv = requested.index < 0 ? input : input.flatMap((argument, index) => index === requested.index || index === requested.index + 1 ? [] : [argument])
  if(argv[0]==="-v"||argv[0]==="--version")argv=["version"]
  const first=argv[0]
  const commands: Args["command"][] = ["run", "auth", "config", "doctor", "sessions", "resume", "errors", "extensions", "agents", "acp", "worktrees", "version", "update"]
  const command:Args["command"] = commands.includes(first as Args["command"]) ? first as Args["command"] : "chat"
  if(command!=="chat")argv=argv.slice(1)
  let workspace=process.cwd(),taskFile:string|undefined,artifactDirectory:string|undefined,yes=false,json=false,outputFormat:Args["outputFormat"]="text",maxSteps=DEFAULT_MAX_TURNS,timeoutSeconds=600,continueSession=false,sessionId:string|undefined,approvalMode:ApprovalMode="ask",model:string|undefined,provider:string|undefined,worktree:string|undefined,agent:string|undefined
  const images:string[]=[]
  let configAction:Args["configAction"]
  if(command==="config"){
    const action=argv.shift()??"show"
    if(action!=="show"&&action!=="setup")argumentError(displayLanguage, "Unknown config action: {action}", { action })
    configAction=action
  }
  if(command==="resume"&&argv[0]&&!argv[0]!.startsWith("-"))sessionId=argv.shift()
  const task:string[]=[]
  for(let index=0;index<argv.length;index++){
    const arg=argv[index]!
    if(arg==="-h"||arg==="--help"){console.log(usage(displayLanguage));process.exit(0)}
    if(arg==="-y"||arg==="--yes"){yes=true;approvalMode="full-access";continue}
    if(arg==="--approval-mode"){
      const mode=argv[++index]
      if(mode!=="ask"&&mode!=="auto"&&mode!=="full-access")argumentError(displayLanguage, "--approval-mode must be ask, auto, or full-access")
      approvalMode=mode;yes=mode==="full-access";continue
    }
    if(arg==="--json"){json=true;outputFormat="json";continue}
    if(arg==="--output-format"){
      const format=argv[++index]
      if(format!=="text"&&format!=="json"&&format!=="stream-json")argumentError(displayLanguage, "--output-format must be text, json, or stream-json")
      outputFormat=format;json=format==="json";continue
    }
    if(arg==="--continue"){continueSession=true;continue}
    if(arg==="-C"||arg==="--cwd"){workspace=argv[++index]??"";if(!workspace)argumentError(displayLanguage, "{argument} requires a path", { argument: arg });continue}
    if(arg==="--task-file"){taskFile=argv[++index]??"";if(!taskFile)argumentError(displayLanguage, "--task-file requires a path");continue}
    if(arg==="--artifact-dir"){artifactDirectory=argv[++index]??"";if(!artifactDirectory)argumentError(displayLanguage, "--artifact-dir requires a path");continue}
    if(arg==="--max-steps"){maxSteps=Number(argv[++index]);if(!Number.isInteger(maxSteps)||maxSteps<1)argumentError(displayLanguage, "--max-steps must be a positive integer");continue}
    if(arg==="--timeout"){timeoutSeconds=Number(argv[++index]);if(!Number.isFinite(timeoutSeconds)||timeoutSeconds<=0)argumentError(displayLanguage, "--timeout must be a positive number");continue}
    if(arg==="--model"){model=argv[++index];if(!model)argumentError(displayLanguage, "--model requires a preset");continue}
    if(arg==="--provider"){provider=argv[++index];if(!provider)argumentError(displayLanguage, "--provider requires a name");continue}
    if(arg==="--agent"){agent=argv[++index];if(!agent)argumentError(displayLanguage, "--agent requires a profile name");continue}
    if(arg==="--image"){const image=argv[++index];if(!image)argumentError(displayLanguage, "--image requires a path");images.push(image);continue}
    if(arg==="--worktree"){worktree="";continue}
    if(arg.startsWith("--worktree=")){worktree=arg.slice("--worktree=".length);continue}
    if(arg.startsWith("-"))argumentError(displayLanguage, "Unknown argument: {argument}", { argument: arg })
    task.push(arg)
  }
  if(command==="run"&&task.length&&taskFile)argumentError(displayLanguage, "Use either a task argument or --task-file, not both")
  let sessionAction:Args["sessionAction"],sessionQuery:string|undefined,sessionTitle:string|undefined,exportFormat:Args["exportFormat"],output:string|undefined
  if(command==="sessions"){
    const action=task.shift()??"list"
    if(!["list","search","delete","rename","export"].includes(action))argumentError(displayLanguage, "Unknown sessions action: {action}", { action })
    sessionAction=action as Args["sessionAction"]
    if(sessionAction==="search"){
      sessionQuery=task.join(" ").trim()
      if(!sessionQuery)argumentError(displayLanguage, "Usage: do-code sessions search <query>")
    }else if(sessionAction==="delete"){
      sessionId=task.shift()
      if(!sessionId||task.length)argumentError(displayLanguage, "Usage: do-code sessions delete <session-id>")
    }else if(sessionAction==="rename"){
      sessionId=task.shift();sessionTitle=task.join(" ").trim()
      if(!sessionId||!sessionTitle)argumentError(displayLanguage, "Usage: do-code sessions rename <session-id> <name>")
    }else if(sessionAction==="export"){
      sessionId=task.shift()
      const format=task.shift()??"md"
      if(!sessionId||(format!=="md"&&format!=="json"))argumentError(displayLanguage, "Usage: do-code sessions export <session-id> [md|json] [output]")
      exportFormat=format;output=task.shift()
      if(task.length)argumentError(displayLanguage, "Usage: do-code sessions export <session-id> [md|json] [output]")
    }else if(task.length)argumentError(displayLanguage, "Usage: do-code sessions [list]")
  }
  let errorAction:Args["errorAction"],errorIdValue:string|undefined
  if(command==="errors"){
    const action=task.shift()??"list"
    if(action!=="list"&&action!=="show")argumentError(displayLanguage, "Unknown errors action: {action}", { action })
    errorAction=action
    if(action==="show"){
      errorIdValue=task.shift()
      if(!errorIdValue||task.length)argumentError(displayLanguage, "Usage: do-code errors show <error-id>")
    }else if(task.length)argumentError(displayLanguage, "Usage: do-code errors [list]")
  }
  let updateAction:Args["updateAction"],updateChannel:Args["updateChannel"]
  if(command==="update"){
    const action=task.shift()??"check",channel=task.shift()??"stable"
    if((action!=="check"&&action!=="install")||(channel!=="stable"&&channel!=="preview")||task.length)argumentError(displayLanguage, "Usage: do-code update [check|install] [stable|preview]")
    updateAction=action;updateChannel=channel
  }
  if(command!=="run"&&command!=="chat"&&command!=="sessions"&&command!=="errors"&&command!=="update"&&task.length)argumentError(displayLanguage, "Unknown argument: {argument}", { argument: task[0] ?? "" })
  if(command!=="run"&&command!=="chat"&&(taskFile||json||outputFormat!=="text"||artifactDirectory))argumentError(displayLanguage, "Task and output options are only available in headless mode")
  if(command==="resume")continueSession=true
  return {command,workspace:path.resolve(workspace),yes,approvalMode,json,outputFormat,maxSteps,timeoutSeconds,continueSession,...((command==="run"||command==="chat")&&task.length?{task:task.join(" ")}:{ }),...(taskFile?{taskFile:path.resolve(taskFile)}:{}),...(artifactDirectory?{artifactDirectory:path.resolve(artifactDirectory)}:{}),...(sessionId?{sessionId}:{}),...(sessionAction?{sessionAction}:{}),...(sessionQuery?{sessionQuery}:{}),...(sessionTitle?{sessionTitle}:{}),...(exportFormat?{exportFormat}:{}),...(output?{output}:{}),...(configAction?{configAction}:{}),...(errorAction?{errorAction}:{}),...(errorIdValue?{errorId:errorIdValue}:{}),...(model?{model}:{}),...(provider?{provider}:{}),...(agent?{agent}:{}),...(images.length?{images}:{}),...(language?{language}:{}),...(updateAction?{updateAction}:{}),...(updateChannel?{updateChannel}:{}),...(worktree!==undefined?{worktree}:{})}
}
