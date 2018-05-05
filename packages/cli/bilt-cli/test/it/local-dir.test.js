'use strict'
const path = require('path')
const {expect} = require('chai')
const {describe, it, before, after} = require('mocha')
const {dockerComposeTool, getAddressForService} = require('docker-compose-mocha')
const {fileContents} = require('../utils/file-utils')
const {
  setupBuildDir,
  setupFolder,
  adjustNpmRegistryInfoInRepo,
  checkVersionExists,
} = require('../utils/setup')
const biltHere = require('../../src/bilt-cli')

const testRepoSrc = path.resolve(__dirname, 'bilt-cli/test-repo-local')

describe('local directory use-case', () => {
  const pathToCompose = path.join(__dirname, 'docker-compose.yml')

  let gitServerRepoDir
  before(async () => {
    gitServerRepoDir = await setupFolder(path.join(__dirname, 'bilt-cli/git-server/repos/'))
  })

  const envName = dockerComposeTool(before, after, pathToCompose, {
    envVars: {
      NPM_USER: 'npm-user',
      NPM_PASSWORD: 'npm-user-password',
      get GIT_DIR() {
        return gitServerRepoDir
      },
    },
    shouldPullImages: false,
    brutallyKill: true,
  })

  it('should build the directory with all its packages, including publishing', async () => {
    const npmRegistryAddress = await getAddressForService(
      envName,
      pathToCompose,
      'npm-registry',
      4873,
    )
    const gitServerAddress = await getAddressForService(envName, pathToCompose, 'git-server', 22)

    const remoteRepo = `ssh://git@${gitServerAddress}/git-server/repos/test-repo`

    process.env = {
      ...process.env,
      npm_config_registry: `http://${npmRegistryAddress}/`,
      KEYS_DIR: path.resolve(__dirname, 'bilt-cli/git-server/keys'),
    }

    const buildDir = await setupBuildDir(
      testRepoSrc,
      remoteRepo,
      undefined,
      async buildDir => await adjustNpmRegistryInfoInRepo(buildDir, npmRegistryAddress),
    )

    await biltHere(buildDir)

    expect(await fileContents(buildDir, 'a/postinstalled.txt')).to.equal('')
    expect(await fileContents(buildDir, 'b/postinstalled.txt')).to.equal('')
    expect(await fileContents(buildDir, 'b/built.txt')).to.equal('')
    expect(await fileContents(buildDir, 'b/tested.txt')).to.equal('')
    expect(await fileContents(buildDir, 'c/postinstalled.txt')).to.equal('')
    expect(await fileContents(buildDir, 'c/voodooed.txt')).to.equal('')
    expect(await fileContents(buildDir, 'a/c-voodooed.txt')).to.equal('')

    await checkVersionExists('this-pkg-does-not-exist-in-npmjs.a', '1.0.0', npmRegistryAddress)
    await checkVersionExists('this-pkg-does-not-exist-in-npmjs.b', '3.2.0', npmRegistryAddress)
  })
})
