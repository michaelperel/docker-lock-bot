import { Application } from 'probot' // eslint-disable-line no-unused-vars

const createScheduler = require('probot-scheduler')

async function getLatestSHA(context: any, repo: string, owner: string, defaultBranchName: string): Promise<string> {
  const refs = await context.github.git.listRefs({
    owner: owner,
    repo: repo,
  })

  let sha = ""
  for (const element of refs.data) {
    if (element.ref == `refs/heads/${defaultBranchName}`) {
      sha = element.object.sha
    }
  }
  return sha
}

async function getDefaultBranch(context: any, repo: string, owner: string): Promise<string> {
  const { default_branch } = (await context.github.repos.get({ owner, repo })).data;
  return default_branch
}

function getRepo(context: any): string {
  const {repo} = context.repo()
  return repo
}

function getOwner(context: any): string {
  const {owner} = context.repo()
  return owner
}

function getBranchName(): string {
  return "add-docker-lock8"
}

async function createBranch(context: any, repo:string, owner: string, branchName: string, sha: string) {
  const ref = `refs/heads/${branchName}`
  await context.github.git.createRef({
    owner: owner,
    repo: repo,
    ref: ref,
    sha: sha,
  });
}

async function updateBranch(context: any, repo: string, owner: string, branchName: string) {
    const contents = await context.github.repos.getContents({
      owner: owner,
      repo: repo,
      ref: branchName,
      path: '.'
    });

    let sha = undefined
    for (let d of contents.data) {
      if (d.name == 'docker-lock.json') {
        sha = d.sha
      }
    }
  
    await context.github.repos.createOrUpdateFile({
      owner: owner,
      repo: repo,
      path: 'docker-lock.json',
      branch: branchName,
      message: 'updating docker-lock.json',
      sha,
      // Note, that content goes in the base64 encoding which is an update for upstream in GitHub API
      // content: Buffer.from(JSON.stringify(updatePackageJSONObject, null, 2)).toString('base64'),
      content: Buffer.from('hello').toString('base64')
    });
}

async function createPR(context: any, repo: string, owner: string, branchName: string) {
  const { default_branch } = (await context.github.repos.get({ owner, repo })).data;

  await context.github.pulls.create({
    owner: owner,
    repo: repo,
    title: `Merge ${branchName} as new version of package available`,
    head: branchName,
    base: default_branch,
    maintainer_can_modify: true,
  });
}

export = (app: Application) => {
  createScheduler(app, {
    delay: false, // delay is enabled on first run
    interval: 30 * 1000 // 1 day
  })
  
  // https://github.com/probot/scheduler
  app.on('schedule.repository', async (context) => {
    console.log("SCHEDULED EVENT")

    const repo = getRepo(context)
    const owner = getOwner(context)
    const defaultBranch = await getDefaultBranch(context, repo, owner)

    console.log(repo, owner, defaultBranch)

    const branchName = getBranchName()
    console.log("PR BRANCHNAME:", branchName)

    const sha = await getLatestSHA(context, repo, owner, defaultBranch)
    console.log("SHA:", sha)

    try {
      await createBranch(context, repo, owner, branchName, sha)
    }
    catch (e) {
      console.log(e)
    }

    await updateBranch(context, repo, owner, branchName)
  
    try {
      await createPR(context, repo, owner, branchName)
    }
    catch(e) {
      console.log(e)
    }

    console.log("SCHEDULED EVENT OVER")
  })

  app.on('*', async context => {
    console.log("THIS IS AN APP EVENT")
    context.log({ event: context.event, action: context.payload.action })
    console.log("THIS IS THE END")
  })
}
