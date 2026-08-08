import { chmod, cp, mkdir, rm } from "node:fs/promises"
import path from "node:path"

const projectRoot=path.resolve(import.meta.dirname,"..")
const source=path.join(projectRoot,"dist","src")
const target=path.join(projectRoot,"packages","cli","dist")
const launcherSource=path.join(projectRoot,"scripts","cli-entry.js")
const launcherTarget=path.join(projectRoot,"packages","cli","scripts","cli-entry.js")
const licenseSource=path.join(projectRoot,"LICENSE")
const licenseTarget=path.join(projectRoot,"packages","cli","LICENSE")
await rm(target,{recursive:true,force:true})
await mkdir(target,{recursive:true})
await cp(source,target,{recursive:true})
await mkdir(path.dirname(launcherTarget),{recursive:true})
await cp(launcherSource,launcherTarget)
await cp(licenseSource,licenseTarget)
await chmod(launcherTarget,0o755)
