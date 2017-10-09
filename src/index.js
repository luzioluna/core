// @flow
import { pipe, clone } from 'ramda'
import * as Types from './types'
import NanoEvents from 'nanoevents'
import xhrAdapter from './adapters/xhr'
import fetchAdapter from './adapters/fetch'
import { pipeM, curryBus, mergeHooks, mergeOptions, createHandler, mapComposeHooks } from './utils'

const Apicase: Types.Apicase = {

  // Base for calls
  base: {
    query: {},
    hooks: { }
  },

  // Options
  options: {
    defaultAdapter: 'fetch'
  },

  // Built-in adapters for fetch and XMLHttpRequest
  adapters: {
    fetch: fetchAdapter,
    xhr: xhrAdapter
  },

  // Use it to add a new adapter
  use (name, adapter) {
    this.adapters[name] = adapter
  },

  // Modify apicase object
  install (installer) {
    this.bus.emit('preinstall', this)
    installer(this)
    this.bus.emit('postinstall', this)
  },

  // Get a copy of apicase with modified state
  extend (installer) {
    const instance = clone(this)
    instance.install(installer)
    return instance
  },

  // Make API call
  // TODO: Make it a little simpler
  async call ({
    adapter = this.options.defaultAdapter,
    hooks = {},
    ...query
  } = {}) {

    const h = pipe(mergeHooks, mapComposeHooks)(this.base.hooks, hooks)
    const emit = curryBus(this.bus)
    const options = mergeOptions(this.base.query, query)
    const handle = createHandler(emit, h)

    let isAborted = false
    let abortReason = null

    await handle('before')({
      options,
      abort: (reason) => {
        isAborted = true
        abortReason = reason
      }
    })

    if (isAborted) {
      emit('aborted')({ options, reason: abortReason })
      return Promise.reject({ options, reason: abortReason })
    }

    return new Promise(async (resolve, reject) => {

      const success = data => pipeM(
        handle('finish'),
        r => resolve(r.data)
      )({ data, options, success: true })

      const error = async reason => pipeM(
        handle('finish'),
        r => reject(r.reason)
      )({ reason, options, success: true })

      emit('start')({ options })

      this.adapters[adapter]({
        options,
        done: data => pipeM(handle('success'), success)({ data, options }),
        fail: reason => pipeM(handle('error'), error)({ reason, options }),
        another: (name, data, fail = false) =>
          pipeM(handle(name), ...(fail ? [reject] : []))(data)
      })
    })
  },

  // Like Promise.all but iteratees over calls options
  all (queries) {
    return Promise.all(queries.map(q => this.call(q)))
  },

  // Make a service with prepared options
  // Options from call() and all() methods will be merged with service options
  of ({ hooks = {}, ...options }) {
    return {
      ...this,
      base: {
        query: mergeOptions(this.base.hooks, options),
        hooks: mergeHooks(this.base.hooks, hooks)
      }
    }
  },

  // Events handling
  on (event, callback) {
    return this.bus.on(event, callback)
  },

  // Events emmiter for
  bus: new NanoEvents

}

Apicase.call({
  url: '/test',
  hooks: {
    before({ options, abort }, next) {
      options.url = '/api/posts/1'
      abort('test')
      next()
    },
    success(ctx, next) {
      console.log('success', ctx)
      next()
    },
    error(ctx, next) {
      console.log('error', ctx)
      next()
    },
    finish(ctx, next) {
      console.log('finish', ctx)
      next()
    }
  }
})

export default Apicase

if (process.env.NODE_ENV === 'development') {
  console.log('[DEV] Apicase-core is available in browser console via Apicase global variable')
  window.Apicase = Apicase
}
