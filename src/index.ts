import util from 'util'
import fs from 'fs'
import * as child from 'child_process'

// @ts-ignore
import createScheduler from 'probot-scheduler'
import { Application, Context } from 'probot'

const SCHEDULER_INTERVAL_MS: number = +(process.env.SCHEDULER_INTERVAL_MS || 5 * 60 * 1000) // default to 5 minutes

const SCHEDULER_DELAY = true // when true, random delay between 0 and interval to avoid all schedules being performed at the same time

const PR_BRANCH = "add-docker-lock" // name of branch created/updated on Github

async function getLatestSHA(context: Context, repo: string, owner: string, defaultBranch: string): Promise<string> {
  const refs = await context.github.git.listRefs({
    owner: owner,
    repo: repo,
  })

  let sha = ""
  for (const d of refs.data) {
    if (d.ref == `refs/heads/${defaultBranch}`) {
      sha = d.object.sha
    }
  }

  return sha
}

async function createToken(context: Context, app: Application): Promise<string> {
  // https://github.com/probot/probot/issues/1003
  const auth = await app.auth()
  const resp = await auth.apps.createInstallationToken({ installation_id: context.payload.installation.id })
  return resp.data.token
}

async function getDefaultBranch(context: Context, repo: string, owner: string): Promise<string> {
  const { default_branch } = (await context.github.repos.get({ owner, repo })).data
  return default_branch
}

function getRepo(context: Context): string {
  const { repo } = context.repo()
  return repo
}

function getOwner(context: Context): string {
  const { owner } = context.repo()
  return owner
}

async function dockerLock(repo: string, owner: string, token: string, tmpDir: string, defaultBranch: string, prBranch: string, lockfile: string): Promise<{ stdout: string, stderr: string }> {
  const exec = util.promisify(child.exec)
  const { stdout, stderr } = await exec(`bash ./docker-lock.sh ${repo} ${owner} ${token} ${tmpDir} ${defaultBranch} ${prBranch} ${lockfile}`)
  return { stdout, stderr }
}

async function createTemporaryDirectory(): Promise<string> {
  const mkDir = util.promisify(fs.mkdtemp)
  return await mkDir('tmp-')
}

async function removeTemporaryDirectory(dir: string) {
  const rmDir = util.promisify(fs.rmdir)
  await rmDir(dir, { recursive: true })
}

async function readLockfile(filepath: string): Promise<string> {
  const readF = util.promisify(fs.readFile)
  let rawData = await readF(filepath)
  return Buffer.from(rawData).toString('base64')
}

async function createBranch(context: Context, repo: string, owner: string, prBranch: string, sha: string) {
  const ref = `refs/heads/${prBranch}`
  await context.github.git.createRef({
    owner: owner,
    repo: repo,
    ref: ref,
    sha: sha,
  })
}

async function updateBranch(context: Context, repo: string, owner: string, prBranch: string, lockfile: string, lockfileContents: string) {
  const contents = await context.github.repos.getContents({
    owner: owner,
    repo: repo,
    ref: prBranch,
    path: '.'
  })

  if (!Array.isArray(contents.data)) {
    throw new Error(`unexpected contents.data ${contents.data}`)
  }

  let sha = undefined
  for (let d of contents.data) {
    if (d.name == lockfile) {
      sha = d.sha
    }
  }

  await context.github.repos.createOrUpdateFile({
    owner: owner,
    repo: repo,
    path: lockfile,
    branch: prBranch,
    message: "Updated lockfile.",
    sha: sha,
    content: lockfileContents,
  })
}

async function deleteBranch(context: Context, repo: string, owner: string, prBranch: string) {
  const ref = `heads/${prBranch}`
  await context.github.git.deleteRef({
    owner: owner,
    repo: repo,
    ref: ref,
  })
}

async function createPR(context: Context, repo: string, owner: string, defaultBranch: string, prBranch: string) {
  await context.github.pulls.create({
    owner: owner,
    repo: repo,
    title: "🐳🔐🤖",
    body: "Updated lockfile.",
    head: prBranch,
    base: defaultBranch,
    maintainer_can_modify: true,
  })
}

export = (app: Application) => {
  createScheduler(app, {
    delay: SCHEDULER_DELAY,
    interval: SCHEDULER_INTERVAL_MS,
  })

  app.on('pull_request.closed', async (context: Context) => {
    const repo = getRepo(context)
    const owner = getOwner(context)
    await deleteBranch(context, repo, owner, PR_BRANCH)
  })

  // https://github.com/probot/scheduler
  app.on('schedule.repository', async (context: Context) => {
    let tmpDir = ""

    try {
      const lockfile = "docker-lock.json"
      const token = await createToken(context, app)
      const repo = getRepo(context)
      const owner = getOwner(context)
      const defaultBranch = await getDefaultBranch(context, repo, owner)

      tmpDir = await createTemporaryDirectory()
      const { stdout, stderr } = await dockerLock(repo, owner, token, tmpDir, defaultBranch, PR_BRANCH, lockfile)

      if (stdout != "true") {
        return
      }

      //@ts-ignore TS2367
      if (stdout != "true" || stdout != "false") {
        // log any condition except for the expected "true" or "false"
        app.log(repo, owner, stderr)
      }

      const sha = await getLatestSHA(context, repo, owner, defaultBranch)

      try {
        await createBranch(context, repo, owner, PR_BRANCH, sha)
      }
      catch (e) {
        // branch already exists
        app.log(repo, owner, e)
      }

      let lockfileContents = await readLockfile(`./${tmpDir}/${lockfile}`)
      try {
        await updateBranch(context, repo, owner, PR_BRANCH, lockfile, lockfileContents)
      }
      catch (e) {
        // malformed data
        app.log(repo, owner, e)
        return
      }

      try {
        await createPR(context, repo, owner, defaultBranch, PR_BRANCH)
      }
      catch (e) {
        // PR already exists
        app.log(repo, owner, e)
      }
    }

    finally {
      if (tmpDir != "") {
        await removeTemporaryDirectory(tmpDir)
      }
    }
  })
}
