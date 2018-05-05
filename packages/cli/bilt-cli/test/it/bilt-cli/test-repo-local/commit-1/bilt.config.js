const fs = require('fs')
const path = require('path')

module.exports = {
  plugins: {
    'commander:npm': {
      package: '@bilt/npm-commander',
      access: 'public',
      npmAuthenticationLine: '//localhost:4873/:_authToken="NPM_TOKEN"',
    },
    'binaryRunner:npm': async ({pimport}) => {
      return {
        async run({executeCommandArg}) {
          const agent = await pimport(executeCommandArg.agentInstance.kind)
          return await agent.executeCommand(executeCommandArg)
        },
      }
    },
    'builder:npm': {
      artifactDefaults: {publish: true},
    },
    'commander:git': {
      package: '@bilt/git-commander',
      gitAuthenticationKey:
        process.env.KEYS_DIR && fs.readFileSync(path.resolve(process.env.KEYS_DIR, 'id_rsa')),
      gitUserEmail: 'gil@tayar.org',
      gitUserName: 'Gil Tayar',
    },
  },
  publish: true,
}
