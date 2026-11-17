/* global process */

import { spawnSync } from "node:child_process"
import { existsSync } from "node:fs"

const env = { ...process.env, A2TS_CLOUDFLARE_MACHINES: "true" }
const npmExecPath = process.env.npm_execpath
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm"

const run = (command, args) =>
  spawnSync(command, args, {
    env,
    stdio: "inherit",
    shell: process.platform === "win32" && !command.startsWith(process.execPath),
  })

// Run through the npm CLI without relying on a PowerShell script shim: the
// Cloudflare build script must work from GitHub Actions, Cloudflare's build
// runner, and a local Windows shell.
const build =
  npmExecPath && existsSync(npmExecPath)
    ? run(process.execPath, [npmExecPath, "run", "build"])
    : run(npmCommand, ["run", "build"])

if (build.error) {
  console.error(build.error.message)
  process.exit(1)
}
if (build.status !== 0) {
  process.exit(build.status ?? 1)
}

const worker = spawnSync(
  process.execPath,
  ["tools/build-cloudflare-worker.mjs"],
  { env, stdio: "inherit" },
)
if (worker.error) {
  console.error(worker.error.message)
  process.exit(1)
}
if (worker.status !== 0) {
  process.exit(worker.status ?? 1)
}

console.log(
  "Cloudflare Pages build ready in dist with the four-machine menu",
  "(II+, IIe unenhanced, IIe enhanced, IIgs).",
)
