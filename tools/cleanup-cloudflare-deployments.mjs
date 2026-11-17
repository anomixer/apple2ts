/* global process */

import { appendFile } from "node:fs/promises"

const API_BASE = "https://api.cloudflare.com/client/v4"
const TOKEN = process.env.CLOUDFLARE_API_TOKEN
const ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID
const PROJECT_NAME = process.env.CLOUDFLARE_PAGES_PROJECT
const KEEP_RECENT = Number.parseInt(process.env.KEEP_RECENT || "10", 10)
const EXECUTE = (process.env.EXECUTE || "false").toLowerCase() === "true"

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))

const fail = (message) => {
  console.error(message)
  process.exit(1)
}

if (!TOKEN) fail("CLOUDFLARE_API_TOKEN is required")
if (!ACCOUNT_ID) fail("CLOUDFLARE_ACCOUNT_ID is required")
if (!PROJECT_NAME) fail("CLOUDFLARE_PAGES_PROJECT is required")
if (!Number.isInteger(KEEP_RECENT) || KEEP_RECENT < 0) fail("KEEP_RECENT must be a non-negative integer")

const apiPath = (path) =>
  `${API_BASE}/accounts/${encodeURIComponent(ACCOUNT_ID)}/pages/projects/${encodeURIComponent(PROJECT_NAME)}${path}`

const request = async (path, init = {}, attempt = 0) => {
  const response = await fetch(apiPath(path), {
    ...init,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      ...init.headers,
    },
  })
  const body = await response.json()
  if (!response.ok || !body.success) {
    if ((response.status === 429 || response.status >= 500) && attempt < 2) {
      await sleep(1000 * (attempt + 1))
      return request(path, init, attempt + 1)
    }
    const details = (body.errors || []).map((error) => error.message).join("; ")
    throw new Error(`${response.status} ${details || response.statusText}`)
  }
  return body
}

const listDeployments = async () => {
  const deployments = []
  let page = 1
  for (;;) {
    const body = await request(
      `/deployments?page=${page}&per_page=100`,
    )
    if (!Array.isArray(body.result)) {
      throw new Error("Cloudflare returned a non-array deployment list")
    }
    deployments.push(...body.result)
    const info = body.result_info
    if (!info || page >= info.total_pages) break
    page++
  }
  return deployments
}

const deploymentTimestamp = (deployment) => {
  const timestamp = Date.parse(deployment.created_on || "")
  return Number.isNaN(timestamp) ? 0 : timestamp
}

const sortByNewest = (deployments) =>
  [...deployments].sort((a, b) => deploymentTimestamp(b) - deploymentTimestamp(a))

const deploymentLabel = (deployment) => {
  const branch = deployment.deployment_trigger?.metadata?.branch || "-"
  const commit = deployment.deployment_trigger?.metadata?.commit_hash?.slice(0, 7) || "-"
  return `${deployment.id} ${deployment.environment} ${deployment.created_on || "-"} ${branch} ${commit}`
}

const run = async () => {
  console.log(`Cloudflare Pages project: ${PROJECT_NAME}`)
  console.log(`Account: ${ACCOUNT_ID.slice(0, 4)}…${ACCOUNT_ID.slice(-4)}`)
  console.log(`Keep: current production + newest ${KEEP_RECENT} deployments; execute=${EXECUTE}`)

  const projectBody = await request("", {
    headers: { "Content-Type": "application/json" },
  })
  const canonicalDeployment = projectBody.result?.canonical_deployment
  const canonicalId = canonicalDeployment?.id

  const deployments = sortByNewest(await listDeployments())
  console.log(`Deployments found: ${deployments.length}`)
  if (canonicalId) {
    console.log(`Current production deployment: ${deploymentLabel(canonicalDeployment)}`)
  } else {
    console.log("Current production deployment: none found")
  }

  const keepIds = new Set()
  if (canonicalId) keepIds.add(canonicalId)
  for (const deployment of deployments.slice(0, KEEP_RECENT)) {
    keepIds.add(deployment.id)
  }
  // Preserve deployments that are still building or queued, even if an older
  // deployment falls outside the newest-N list.
  for (const deployment of deployments) {
    if (deployment.latest_stage?.status === "active" || deployment.latest_stage?.status === "idle") {
      keepIds.add(deployment.id)
    }
  }

  const kept = deployments.filter((deployment) => keepIds.has(deployment.id))
  const candidates = deployments.filter((deployment) => !keepIds.has(deployment.id))

  console.log(`Keeping ${kept.length} deployments:`)
  for (const deployment of kept) console.log(`  KEEP   ${deploymentLabel(deployment)}`)
  console.log(`Delete candidates (${candidates.length}):`)
  for (const deployment of candidates) console.log(`  DELETE ${deploymentLabel(deployment)}`)

  if (candidates.length === 0) {
    console.log("No old deployments to delete.")
    return
  }
  if (!EXECUTE) {
    console.log("DRY RUN: no deployments were deleted. Set EXECUTE=true to delete above candidates.")
    return
  }

  let deleted = 0
  const failures = []
  for (const deployment of candidates) {
    try {
      await request(`/deployments/${encodeURIComponent(deployment.id)}?force=true`, {
        method: "DELETE",
      })
      deleted++
      if (deleted % 50 === 0) console.log(`Deleted ${deleted} deployments...`)
    } catch (error) {
      failures.push({ deployment, error })
      console.error(`FAILED ${deploymentLabel(deployment)}: ${error.message}`)
    }
  }

  console.log(`Deleted ${deleted} of ${candidates.length} candidate deployments.`)
  if (failures.length > 0) {
    console.error(`${failures.length} deployments could not be deleted.`)
    process.exitCode = 1
  }

  const summary = [
    "# Cloudflare Pages deployment cleanup",
    "",
    `- Project: \`${PROJECT_NAME}\``,
    `- Deployments found: ${deployments.length}`,
    `- Kept: ${kept.length}`,
    `- Delete candidates: ${candidates.length}`,
    `- Deleted: ${deleted}`,
    `- Failed: ${failures.length}`,
    `- Execute: ${EXECUTE}`,
  ].join("\n")
  if (process.env.GITHUB_STEP_SUMMARY) {
    await appendFile(process.env.GITHUB_STEP_SUMMARY, `${summary}\n`)
  }
}

run().catch((error) => {
  console.error(error)
  process.exit(1)
})
