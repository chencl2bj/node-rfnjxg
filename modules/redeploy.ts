import { DebugLog, DeployResponse } from '@/services/app'
import { appSocketListener, asyncAppSocketSend, WS_EVENT } from '@/utils/websocket/appSocket'
import { nprogress } from '@/utils/effect'
import { defineStore } from 'pinia'
import { useDebugStore } from './debug'
import { useFileStore } from './file'
import { useDeployStore } from './deploy'
import { EnumFileStatus } from '@/services/file'

type RedeployStore = {
  redeployModalVisible: boolean
  version: number
  fucntions: { name: string }[]
  desc: string
  runtime: string
}

export const useRedeployStore = defineStore('redeploy', {
  state: (): RedeployStore => ({
    redeployModalVisible: false,
    version: 0,
    fucntions: [],
    desc: '',
    runtime: '',
  }),
  getters: {
    funcs(state) {
      return state.fucntions.map((func) => func.name)
    },
  },
  actions: {
    changeRedeployModalVisible(visible: boolean) {
      this.redeployModalVisible = visible
    },
    async submitRedeploy() {
      this.redeployModalVisible = false
      nprogress.inc(0.5)

      const debugStore = useDebugStore()
      debugStore.clearLogs()

      const removeListener = appSocketListener(WS_EVENT.DEBUG_LOG, (log: DebugLog) => {
        debugStore.addServerLog(log)
      })

      const fileStore = useFileStore()
      fileStore.updateFileByNames(this.funcs, {
        status: EnumFileStatus.Deploying,
      })

      let res: DeployResponse | undefined
      try {
        res = (await asyncAppSocketSend(WS_EVENT.FILE_REDEPLOY, {
          version: this.version,
          desc: `Redeployed from version ${this.version}`,
        })) as DeployResponse
      } catch (error: any) {
        let errMsg = error.message || 'Deploy failed.'
        debugStore.addDebugLog({
          content: errMsg,
          level: 'error',
        })
        fileStore.resetFiles(this.funcs);
      }
      removeListener.dispose()

      if (res?.functions.length) {
        fileStore.setFiles({ functions: res.functions })
      }

      const deployStore = useDeployStore()
      deployStore.updateDeployHistory()
    },
  },
})
