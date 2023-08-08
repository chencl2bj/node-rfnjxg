import {
  appSocketListener,
  asyncAppSocketSend,
  genMsgId,
  WS_EVENT,
} from '@/utils/websocket/appSocket'
import { DebugLogLevel, IDebugLog, IOnlineRequest } from '@/services/type'
import { logger } from '@/utils/debug'
import { defineStore } from 'pinia'
import { useFileStore } from './file'
import { acMessage } from '@/utils/effect'
import { DebugLog, DebugResponse } from '@/services/app'
import dayjs from 'dayjs'
import { fileCanDebug } from '@/utils/file'
import { actionCurrentTab, openResponsePanel } from '@/pages/workbench/hooks'
import { useAppStore } from './app'
import { useDependencyStore } from './dependency'
import { isEmpty } from 'lodash-es'
import {
  getDebugEntryFileKey as getEntryFileKey,
  getDebugParamKey as getParamKey,
  localForage,
} from '@/utils/localforage'
import { nanoid } from 'nanoid'
import { debug } from 'debug'
import { useEnvStore } from './env'

const log = debug('ac:debug:store')

export const HTTP_METHODS = ['POST', 'GET', 'PUT', 'DELETE']
export type Header = {
  key: string
  value: string
  enable?: boolean
}
type DebugState = {
  debugging: boolean
  logs: IDebugLog[]
  entryFile: string
  paramsInvalid: boolean
  debugReady: boolean
  request: {
    params: string
    headers: Header[]
  }
  response: {
    body: string
    headers: Header[]
    statusCode: number
    cost: number
    size: number
  }
  onlineRequests: IOnlineRequest[]
}

function getDefaultRequestVal() {
  return {
    params: JSON.stringify({ hi: 'aircode' }, null, 2),
    headers: [
      {
        key: '',
        value: '',
        enable: true,
      },
    ],
  }
}

export const useDebugStore = defineStore('debug', {
  state: (): DebugState => ({
    debugging: false,
    logs: [],
    entryFile: '',
    paramsInvalid: false,
    debugReady: false,
    request: getDefaultRequestVal(),
    response: {
      // body: JSON.stringify({ test: 'hello, aircode' }, null, 2),
      body: '',
      headers: [],
      statusCode: 0,
      cost: 0,
      size: 0,
    },
    onlineRequests: [],
  }),
  getters: {
    debugFile(state) {
      const fileStore = useFileStore()
      return state.entryFile ? state.entryFile : fileStore.currentFile?.name
    },
    responseContentType(state) {
      const header = state.response.headers.find(
        (item) => item.key.toLowerCase() === 'content-type'
      )
      return header?.value.toLowerCase()
    },
    debugDisabled(state) {
      const depStore = useDependencyStore()
      return !state.debugReady || depStore.installing
    },
    debugTips(state) {
      if (!state.debugReady) {
        return 'The debug environment is initializing. Please wait for it to finish.'
      }
      return 'Please wait for the dependencies installation to complete.'
    },
  },
  actions: {
    onDebugReady(ready = true) {
      this.debugReady = ready
    },
    async changeDebugFile(name: string) {
      this.entryFile = name
      const key = this.getDebugEntryFileKey()
      await localForage.set(key, name)
    },
    async saveDebugRequest() {
      const key = this.getDebugParamKey()
      await localForage.set(key, this.request)
    },
    getDebugEntryFileKey() {
      const appId = useAppStore().currentApp?.appId || ''
      return getEntryFileKey(appId)
    },
    getDebugParamKey() {
      const appId = useAppStore().currentApp?.appId || ''
      return getParamKey(appId, this.debugFile as string)
    },
    clearLogs() {
      this.logs = []
    },
    async startDebug() {
      if (!this.debugFile) {
        acMessage.error('First select a file that you can debug')
        return
      }
      if (!fileCanDebug(this.debugFile)) {
        acMessage.error('This file cannot be debugged')
        return
      }
      if (this.paramsInvalid) {
        acMessage.error('Params is invalid')
        return
      }
      if (this.debugging) return

      log('debug start')

      // 切换到 Console 面板
      actionCurrentTab.value = 'console'
      // 打开 Response 面板
      openResponsePanel()
      const msgId = genMsgId()
      const removeListener = appSocketListener(
        WS_EVENT.DEBUG_LOG,
        (log: DebugLog) => {
          this.addServerLog(log)
        },
        msgId,
        true
      )
      this.debugging = true
      this.clearLogs()
      this.resetResponse()
      const appStore = useAppStore()
      const envStore = useEnvStore()
      const envs = envStore.envs
        .map(item => ({ key: item?.key, value: item?.value }))
        .filter(env => env?.key)
      try {
        const headers = this.request.headers.filter((item) => !!item.key)
        const res = (await asyncAppSocketSend(
          WS_EVENT.FILE_DEBUG,
          {
            func: this.debugFile,
            body: this.request.params,
            headers,
            envs
          },
          // add 10s buffer
          ((appStore.currentApp.funcTimeout || 60) + 10) * 1000,
          msgId
        )) as DebugResponse

        this.debugging = false
        log('debug response')
        this.response = {
          ...res,
          headers: Object.keys(res.headers).map((i) => ({ key: i, value: res.headers[i] })),
          body: res.body,
          size: getResponseSize(res.body, res.headers),
        }
      } catch (error: any) {
        log('debug error', error)
        this.debugging = false
        if (this.logs.length === 0) {
          let errMsg = error.message || 'Debug failed, please try again later.'
          if (error?.timeout) {
            errMsg = 'Debug timeout, please try again later.'
          }
          this.addDebugLog({
            level: 'error',
            time: Date.now(),
            content: errMsg,
          })
        }
      } finally {
        log('debug done')
        removeListener.dispose()
      }
    },
    getDebugLog(payload: any) {
      logger.log('debug log ', payload)
    },
    addDebugLog(payload: RequiredField<IDebugLog, 'content'>) {
      const item: IDebugLog = {
        time: Date.now(),
        level: 'info',
        id: nanoid(),
        ...payload,
        content: payload.content,
      }
      this.logs.push(item)
    },
    addServerLog(log: DebugLog) {
      if (!log) return
      this.addDebugLog({
        content: log.content,
        level: log.logLevel === 'stderr' ? 'error' : 'info',
        time: log.time ? dayjs(log.time).valueOf() : undefined,
        defaultCollapsed: log.logLevel !== 'stderr',
      })
    },
    addHeader() {
      this.request.headers.push({
        key: '',
        value: '',
        enable: true,
      })
    },
    updateHeader(index: number, header: Partial<Header>) {
      this.request.headers[index] = { ...this.request.headers[index], ...header }
      if (this.request.headers[this.request.headers.length - 1].key !== '') {
        this.addHeader()
      }

      this.saveDebugRequest()
    },
    updateAllHeader(header: Partial<Header>) {
      this.request.headers = this.request.headers.map((item) => {
        return {
          ...item,
          ...header,
        }
      })
      this.saveDebugRequest()
    },
    updateOnlineRequests(reqs?: IOnlineRequest[]) {
      this.onlineRequests = Array.isArray(reqs) ? reqs.reverse() : []
    },
    applyOnlineRequest(req: IOnlineRequest) {
      this.request.headers = transformHeaders(req.headers)
      this.request.params = transformParams(isEmpty(req.body) ? req.query : req.body)
    },
    deleteHeader(index: number) {
      if (this.request.headers.length <= 1) {
        return
      }
      this.request.headers.splice(index, 1)

      this.saveDebugRequest()
    },
    resetResponse() {
      this.response = {
        body: '',
        headers: [],
        statusCode: 0,
        cost: 0,
        size: 0,
      }
    },
    restoreDebugParams(request: DebugState['request']) {
      this.request = request ? request : getDefaultRequestVal()
    },
  },
})

type RequiredField<T, K extends keyof T> = Partial<T> & Pick<T, K>

function getResponseSize(body: any, headers: Record<string, string>) {
  const contentLength = headers['Content-Length']
  if (contentLength) {
    return parseInt(headers['Content-Length'], 10) || 0
  }
  if (typeof body === 'object') {
    return JSON.stringify(body).length
  }
  if (typeof body === 'string') {
    return body.length
  }
  return 0
}

function transformHeaders(headers?: Record<string, string>, enable = true): Header[] {
  if (!headers) return []
  return Object.keys(headers).map((i) => ({ key: i, value: headers[i], enable }))
}

function transformParams(params?: object) {
  try {
    return JSON.stringify(params, null, 2)
  } catch (error) {
    return '{}'
  }
}
