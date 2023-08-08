import {
  appSocketListener,
  MessageReceivedPayload,
  useAppSocket,
  WS_EVENT,
} from '@/utils/websocket/appSocket'
import { acMessage, getQuery } from '@/utils/effect'
import { defineStore } from 'pinia'
import { useAppStore } from './app'
import { useDebugStore } from './debug'
import { useFileStore } from './file'
import { useUserStore } from './user'
import { useDeployStore } from './deploy'
import { IApp } from '@/services/app'
import { IFile } from '@/services/file'
import { InstalledDependency } from '@/services/dependency'
import { useDependencyStore } from './dependency'
import { CodeMirror } from '@/components/editor'
import { useEnvStore } from './env'
import { isEmpty } from 'lodash-es'

type WorkbenchState = {
  inited: boolean
}

type WorkspacePayload = {
  app: IApp
  functions: IFile[]
  packages: InstalledDependency[]
}

export let editor: CodeMirror

export const useWorkbenchStore = defineStore('workbench', {
  state: (): WorkbenchState => ({
    inited: false,
  }),
  getters: {
    filesLoading(state) {
      const fileStore = useFileStore()
      const userStore = useUserStore()
      return !state.inited || fileStore.filesLoading || !userStore.isLogin
    },
    appOperationLoading(state) {
      const userStore = useUserStore()
      return !state.inited || !userStore.isLogin
    },
    editorLoading(state) {
      const fileStore = useFileStore()
      const userStore = useUserStore()
      return (
        !state.inited || fileStore.filesLoading || fileStore.isOpeningFile || !userStore.isLogin
      )
    },
    devopsLoading(state) {
      const fileStore = useFileStore()
      const userStore = useUserStore()
      return !state.inited || fileStore.filesLoading || !userStore.isLogin
    },
    debugLoading(state) {
      const fileStore = useFileStore()
      const userStore = useUserStore()
      return !state.inited || fileStore.filesLoading || !userStore.isLogin
    },
    databaseLoading(state) {
      const userStore = useUserStore()
      return !state.inited || !userStore.isLogin
    },
  },
  actions: {
    async init(appId: string) {
      const appStore = useAppStore()
      const userStore = useUserStore()
      if (!userStore.isLogin) {
        await userStore.getUser()
      }
      await appStore.getAppInfo(appId)

      // FIXME: 临时写死，联调使用
      // const endpoint = appStore.currentApp?.endpoint
      // if (!endpoint) {
      //   return
      // }
      const endpoint = `${import.meta.env.VITE_APP_WS_URL}`
      // const endpoint = `ws://api.aircode.io/regional/ws?appId=${appId}`
      // 建立 ws
      useAppSocket(endpoint, appId, {
        onConnected: () => {
          this.listenWorkspaceInited()
          this.listenDebugInit()
        },
      })

      // 开始加载资源
      // appSocketSend(WS_EVENT.FILE_LIST, { verbose: true })
      // appSocketSend(WS_EVENT.DEP_LIST)
    },
    async listenWorkspaceInited() {
      const listener = appSocketListener(
        WS_EVENT.SYSTEM_WORKSPACE_INIT,
        (payload: WorkspacePayload, resp: MessageReceivedPayload<WorkspacePayload>) => {
          if (resp.success) {
            const fileStore = useFileStore()
            const dependencyStore = useDependencyStore()
            fileStore.setFiles(payload)
            dependencyStore.setList({ list: payload.packages })

            if (!isEmpty(payload.app)) {
              // 初始化
              if (payload.app.appInit) {
                // 创建默认的 hello.js
                fileStore.addFileBefore('hello.js')
              }
              const appStore = useAppStore()
              appStore.updateCurrentApp(payload.app)
              appStore.readApp()
            }
            this.initOutputLog()

            this.inited = true
            listener.dispose()
          } else {
            acMessage.error(resp.error?.message || 'Init workspace failed')
          }
        }
      )
    },
    listenDebugInit() {
      const listener = appSocketListener(WS_EVENT.DEBUG_INIT, () => {
        const debugStore = useDebugStore()
        debugStore.onDebugReady()
        listener.dispose()
      })
    },
    initCurrentFile() {
      const fileStore = useFileStore()
      const file = getQuery('file')
      if (file) {
        fileStore.changeFile(file)
      }
    },
    initEditor() {
      // TODO 处理 editor 和 fsp 的关联
      editor = new CodeMirror()
    },
    initOutputLog() {
      // handle the ws reconnection
      if (this.inited) {
        return true
      }
      const debugStore = useDebugStore()
      const appStore = useAppStore()
      debugStore.addDebugLog({
        content:
          'Welcome to AirCode. You can now write code and debug online, then click "Deploy" button to ship your function. For more information, check our developer guides at https://docs.aircode.io',
        ignoreMultiLine: true,
        link: true,
      })
      debugStore.addDebugLog({
        content: `Runtime: ${appStore.runtimeName}. Function execution timeout: ${appStore.currentApp.funcTimeout} seconds.`,
        ignoreMultiLine: true,
      })
    },
    reset() {
      const fileStore = useFileStore()
      const debugStore = useDebugStore()
      const depStore = useDependencyStore()
      const deployStore = useDeployStore()
      const appStore = useAppStore()
      const envStore = useEnvStore()
      envStore.$reset()
      fileStore.$reset()
      debugStore.$reset()
      depStore.$reset()
      deployStore.$reset()
      this.$reset()
      appStore.resetState()
    },
  },
})
