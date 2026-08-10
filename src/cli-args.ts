import path from "node:path"
import type { ApprovalMode } from "./policy.js"
import { DEFAULT_MAX_TURNS } from "./turn-limits.js"

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
  updateAction?: "check" | "install"
  updateChannel?: "stable" | "preview"
}

export function usage() {
  return `Usage:
  do-code [options]                    Start the interactive coding agent
  do-code --continue [options]         Continue the latest project session
  do-code resume [session-id]          Resume a session or the latest session
  do-code sessions [list]              List project sessions
  do-code sessions search <query>      Search sessions
  do-code sessions rename <id> <name>  Rename a session
  do-code sessions delete <id>         Delete a session
  do-code sessions export <id> [md|json] [output]
  do-code run [options] "task"         Run one task and exit
  echo "task" | do-code                Run a headless task from stdin
  do-code auth                         Configure a model with the guided setup
  do-code config setup                 Same guided model setup
  do-code config [show]                Show model configuration (secrets hidden)
  do-code doctor                       Check the model, workspace, and local tools
  do-code errors [list]                List recent error reports
  do-code errors show <error-id>       Show a bad case and reproduction context
  do-code extensions                   Show commands, skills, and MCP extensions
  do-code agents                       List configured agent profiles
  do-code version                      Show the installed version
  do-code update [check|install] [stable|preview]
  do-code acp                          Start the ACP server over stdin/stdout
  do-code worktrees                    List do-code worktrees

Options:
  -C, --cwd <path>       Working directory (default: current directory)
  -y, --yes              Use full-access mode (no ordinary approval prompts)
  --approval-mode <mode> ask | auto | full-access
  --continue             Continue the latest session
  --task-file <path>     Read the task from a UTF-8 file
  --artifact-dir <path>  Set the trace, patch, and result directory
  --json                 Output JSON from do-code run
  --output-format <fmt>  text | json | stream-json
  --max-steps <number>   Maximum model turns per task (default: ${DEFAULT_MAX_TURNS})
  --timeout <seconds>    Total runtime budget (default: 600)
  --model <preset>       Select a provider/model preset
  --provider <name>      Select a provider with a model name
  --agent <name>         Use a configured agent profile
  --image <path>         Attach a workspace image (repeatable)
  --worktree[=name]      Run in an isolated Git worktree
  -h, --help             Show help
  -v, --version          Show version

Model configuration priority:
  system < user < project < environment < --provider/--model`
}

export function parseArgs(input: string[]): Args {
  let argv=[...input]
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
    if(action!=="show"&&action!=="setup")throw new Error(`Unknown config action: ${action}`)
    configAction=action
  }
  if(command==="resume"&&argv[0]&&!argv[0]!.startsWith("-"))sessionId=argv.shift()
  const task:string[]=[]
  for(let index=0;index<argv.length;index++){
    const arg=argv[index]!
    if(arg==="-h"||arg==="--help"){console.log(usage());process.exit(0)}
    if(arg==="-y"||arg==="--yes"){yes=true;approvalMode="full-access";continue}
    if(arg==="--approval-mode"){
      const mode=argv[++index]
      if(mode!=="ask"&&mode!=="auto"&&mode!=="full-access")throw new Error("--approval-mode must be ask, auto, or full-access")
      approvalMode=mode;yes=mode==="full-access";continue
    }
    if(arg==="--json"){json=true;outputFormat="json";continue}
    if(arg==="--output-format"){
      const format=argv[++index]
      if(format!=="text"&&format!=="json"&&format!=="stream-json")throw new Error("--output-format must be text, json, or stream-json")
      outputFormat=format;json=format==="json";continue
    }
    if(arg==="--continue"){continueSession=true;continue}
    if(arg==="-C"||arg==="--cwd"){workspace=argv[++index]??"";if(!workspace)throw new Error(`${arg} requires a path`);continue}
    if(arg==="--task-file"){taskFile=argv[++index]??"";if(!taskFile)throw new Error("--task-file requires a path");continue}
    if(arg==="--artifact-dir"){artifactDirectory=argv[++index]??"";if(!artifactDirectory)throw new Error("--artifact-dir requires a path");continue}
    if(arg==="--max-steps"){maxSteps=Number(argv[++index]);if(!Number.isInteger(maxSteps)||maxSteps<1)throw new Error("--max-steps must be a positive integer");continue}
    if(arg==="--timeout"){timeoutSeconds=Number(argv[++index]);if(!Number.isFinite(timeoutSeconds)||timeoutSeconds<=0)throw new Error("--timeout must be a positive number");continue}
    if(arg==="--model"){model=argv[++index];if(!model)throw new Error("--model requires a preset");continue}
    if(arg==="--provider"){provider=argv[++index];if(!provider)throw new Error("--provider requires a name");continue}
    if(arg==="--agent"){agent=argv[++index];if(!agent)throw new Error("--agent requires a profile name");continue}
    if(arg==="--image"){const image=argv[++index];if(!image)throw new Error("--image requires a path");images.push(image);continue}
    if(arg==="--worktree"){worktree="";continue}
    if(arg.startsWith("--worktree=")){worktree=arg.slice("--worktree=".length);continue}
    if(arg.startsWith("-"))throw new Error(`Unknown argument: ${arg}`)
    task.push(arg)
  }
  if(command==="run"&&task.length&&taskFile)throw new Error("Use either a task argument or --task-file, not both")
  let sessionAction:Args["sessionAction"],sessionQuery:string|undefined,sessionTitle:string|undefined,exportFormat:Args["exportFormat"],output:string|undefined
  if(command==="sessions"){
    const action=task.shift()??"list"
    if(!["list","search","delete","rename","export"].includes(action))throw new Error(`Unknown sessions action: ${action}`)
    sessionAction=action as Args["sessionAction"]
    if(sessionAction==="search"){
      sessionQuery=task.join(" ").trim()
      if(!sessionQuery)throw new Error("Usage: do-code sessions search <query>")
    }else if(sessionAction==="delete"){
      sessionId=task.shift()
      if(!sessionId||task.length)throw new Error("Usage: do-code sessions delete <session-id>")
    }else if(sessionAction==="rename"){
      sessionId=task.shift();sessionTitle=task.join(" ").trim()
      if(!sessionId||!sessionTitle)throw new Error("Usage: do-code sessions rename <session-id> <name>")
    }else if(sessionAction==="export"){
      sessionId=task.shift()
      const format=task.shift()??"md"
      if(!sessionId||(format!=="md"&&format!=="json"))throw new Error("Usage: do-code sessions export <session-id> [md|json] [output]")
      exportFormat=format;output=task.shift()
      if(task.length)throw new Error("Usage: do-code sessions export <session-id> [md|json] [output]")
    }else if(task.length)throw new Error("Usage: do-code sessions [list]")
  }
  let errorAction:Args["errorAction"],errorIdValue:string|undefined
  if(command==="errors"){
    const action=task.shift()??"list"
    if(action!=="list"&&action!=="show")throw new Error(`Unknown errors action: ${action}`)
    errorAction=action
    if(action==="show"){
      errorIdValue=task.shift()
      if(!errorIdValue||task.length)throw new Error("Usage: do-code errors show <error-id>")
    }else if(task.length)throw new Error("Usage: do-code errors [list]")
  }
  let updateAction:Args["updateAction"],updateChannel:Args["updateChannel"]
  if(command==="update"){
    const action=task.shift()??"check",channel=task.shift()??"stable"
    if((action!=="check"&&action!=="install")||(channel!=="stable"&&channel!=="preview")||task.length)throw new Error("Usage: do-code update [check|install] [stable|preview]")
    updateAction=action;updateChannel=channel
  }
  if(command!=="run"&&command!=="chat"&&command!=="sessions"&&command!=="errors"&&command!=="update"&&task.length)throw new Error(`Unknown argument: ${task[0]}`)
  if(command!=="run"&&command!=="chat"&&(taskFile||json||outputFormat!=="text"||artifactDirectory))throw new Error("Task and output options are only available in headless mode")
  if(command==="resume")continueSession=true
  return {command,workspace:path.resolve(workspace),yes,approvalMode,json,outputFormat,maxSteps,timeoutSeconds,continueSession,...((command==="run"||command==="chat")&&task.length?{task:task.join(" ")}:{ }),...(taskFile?{taskFile:path.resolve(taskFile)}:{}),...(artifactDirectory?{artifactDirectory:path.resolve(artifactDirectory)}:{}),...(sessionId?{sessionId}:{}),...(sessionAction?{sessionAction}:{}),...(sessionQuery?{sessionQuery}:{}),...(sessionTitle?{sessionTitle}:{}),...(exportFormat?{exportFormat}:{}),...(output?{output}:{}),...(configAction?{configAction}:{}),...(errorAction?{errorAction}:{}),...(errorIdValue?{errorId:errorIdValue}:{}),...(model?{model}:{}),...(provider?{provider}:{}),...(agent?{agent}:{}),...(images.length?{images}:{}),...(updateAction?{updateAction}:{}),...(updateChannel?{updateChannel}:{}),...(worktree!==undefined?{worktree}:{})}
}
