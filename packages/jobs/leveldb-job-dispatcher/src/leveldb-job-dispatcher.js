'use strict'
const debug = require('debug')('bildit:leveldb-job-dispatcher')
const path = require('path')
const {promisify: p} = require('util')
const makeDir = require('make-dir')
const levelQueue = require('level-q')
const level = require('level')
const bytewise = require('bytewise')
const {runJob, prepareJobForRunning, deleteJobState} = require('@bildit/jobs')

module.exports = async ({pluginRepository, events, directory}) => {
  const {queue, kvStoreDb} = await initializeDb()
  await listenAndExecuteJobs()

  const kvStore = {
    get: key =>
      p(kvStoreDb.get.bind(kvStoreDb))(key).catch(err => {
        if (err.type === 'NotFoundError') return undefined
        return Promise.reject(err)
      }),
    set: p(kvStoreDb.put.bind(kvStoreDb)),
    delete: p(kvStoreDb.del.bind(kvStoreDb)),
  }

  await ensureJobStateIsRemovedWhenJobsEnd()

  return {
    dispatchJob,
    hasAbortedJobs,
    rerunAbortedJobs,
  }

  async function dispatchJob(job, {awakenedFrom} = {}) {
    const preparedJob = prepareJobForRunning(job)

    debug('saving job %s to store', preparedJob.id)
    await kvStore.set(`job:${preparedJob.id}`, {job: preparedJob, awakenedFrom})

    debug('dispatching job %o to queue', preparedJob)
    await p(queue.push)({job: preparedJob, awakenedFrom})

    return preparedJob
  }

  async function hasAbortedJobs() {
    return await new Promise((resolve, reject) =>
      kvStoreDb
        .createReadStream({gte: 'job:', lte: 'job:z', keys: true})
        .on('data', () => {
          debug('found aborted jobs', job.id)
          resolve(true)
        })
        .on('error', reject)
        .on('end', resolve(false)),
    )
  }

  async function initializeDb() {
    await makeDir(path.join(directory, '.bildit'))

    const jobQueueDb = await p(level)(path.join(directory, '.bildit', 'job-queue'), {
      keyEncoding: bytewise,
      valueEncoding: 'json',
    })
    const kvStoreDb = await p(level)(path.join(directory, '.bildit', 'kv-store'), {
      keyEncoding: bytewise,
      valueEncoding: 'json',
    })

    const {queue} = levelQueue(jobQueueDb)

    return {queue, kvStoreDb}
  }

  async function listenAndExecuteJobs() {
    debug('listening on level-q queue')
    queue.listen(async (err, value, key, next) => {
      if (err) {
        console.log('Error listening on queue', err.stack)
        throw err
      }
      const {job, awakenedFrom} = value

      debug('got job %s from queue. running it', job.id)
      runJob(job, {awakenedFrom, pluginRepository, events, kvStore, dispatchJob}).catch(err =>
        console.error(err.stack),
      )

      next()
    })
  }

  async function ensureJobStateIsRemovedWhenJobsEnd() {
    events.subscribe('END_JOB', async ({job}) => {
      await kvStore.delete(`job:${job.id}`)

      await deleteJobState(job, {kvStore})
    })
  }

  async function rerunAbortedJobs() {
    const abortedJobs = []

    await new Promise((resolve, reject) =>
      kvStoreDb
        .createReadStream({gte: 'job:', lte: 'job:z', values: true})
        .on('data', ({job, awakenedFrom}) => {
          debug('rerunning job %s', job.id)
          abortedJobs.push(job)
          dispatchJob(job, {awakenedFrom})
        })
        .on('error', reject)
        .on('end', resolve),
    )
    return abortedJobs
  }
}
