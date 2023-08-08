import { DebugLog, DeploymentHistory, DeployResponse, DeployStatus } from '@/services/app'
import { EnumFileStatus } from '@/services/file'
import { logger } from '@/utils/debug'
import { acMessage } from '@/utils/effect'
import { appSocketListener, asyncAppSocketSend, WS_EVENT } from '@/utils/websocket/appSocket'
import { defineStore } from 'pinia'
import { useAppStore } from './app'
import { useDebugStore } from './debug'
import { useDeploymentDetailStore } from './deploymentDetail'
import { useFileStore } from './file'

type DeployState = {
  deployModalVisible: boolean
  deployDetailsModalVisible: boolean
  deployLogModalVisible: boolean
  deploying: boolean
  deployAll: boolean | null
  selectedFiles: string[]
  changelog: string
  deployHistoryLoading: boolean
  deployHistory: DeploymentHistory[]
  selectedDeployVersion: number
  deployDetailsLoading: boolean
  onlineDeploymentDetail: DeploymentHistory | null
  onlineDeploymentDetailLoading: boolean
}

export const useDeployStore = defineStore('deploy', {
  state: (): DeployState => ({
    deployModalVisible: false,
    deployDetailsModalVisible: false,
    deployLogModalVisible: false,
    selectedFiles: [],
    deployAll: false,
    deploying: false,
    changelog: '',
    deployHistoryLoading: true,
    deployHistory: [],
    deployDetailsLoading: true,
    selectedDeployVersion: 0,
    onlineDeploymentDetail: null,
    onlineDeploymentDetailLoading: true,
  }),
  getters: {
    deployingFiles(state) {
      return state.deploying ? state.selectedFiles : []
    },
  },
  actions: {
    changeDeployModalVisible(visible: boolean) {
      this.deployModalVisible = visible
    },
    changeDeployDetailsModalVisible(visible: boolean) {
      this.deployDetailsModalVisible = visible
    },
    changeDeployLogModalVisible(visible: boolean) {
      this.deployLogModalVisible = visible
    },
    changeDeployVersion(version: number) {
      this.selectedDeployVersion = version
    },
    handleDeployDetails(version: number) {
      // Get the last success version
      const lastSuccess = this.deployHistory.find(deployment => deployment.versionNumber < version && deployment.status === 'success')
      const deploymentDetailStore = useDeploymentDetailStore()
      deploymentDetailStore.setVersion(version, lastSuccess?.versionNumber)
      deploymentDetailStore.modalVisible = true
    },
    handleDeployLog(version: number) {
      this.changeDeployVersion(version)
      this.changeDeployLogModalVisible(true)
    },
    changeFiles(files: string[]) {
      this.selectedFiles = files
    },
    async submitDeploy() {
      if (this.deploying) return
      this.deployModalVisible = false
      this.deploying = true
      const fileStore = useFileStore()
      const debugStore = useDebugStore()
      const appStore = useAppStore()
      const files = this.selectedFiles
      debugStore.clearLogs()
      const removeListener = appSocketListener(WS_EVENT.DEBUG_LOG, (log: DebugLog) => {
        debugStore.addServerLog(log)
      })

      fileStore.updateFileByNames(files, {
        isDeploying: true,
      })
      let res: DeployResponse | undefined
      try {
        res = (await asyncAppSocketSend(WS_EVENT.FILE_DEPLOY, {
          functions: files,
          desc: this.changelog,
          all: !!this.deployAll,
        })) as DeployResponse
      } catch (error: any) {
        let errMsg = error.message || 'Deploy failed'
        acMessage.error(errMsg)
        debugStore.addDebugLog({
          content: errMsg,
          level: 'error',
        })
        fileStore.resetFiles(files)
      }
      this.deployDone(files, res)
      removeListener.dispose()
    },
    deployDone(files: string[], res?: DeployResponse) {
      const fileStore = useFileStore()
      fileStore.updateFiles()
      // if (res?.functions.length) {
      //   fileStore.setFiles({ functions: res.functions })
      // }
      this.deploying = false
      this.updateDeployHistory()
    },
    async submitUnDeploy(files: string[]) {
      if (this.deploying) return
      this.deployModalVisible = false
      this.deploying = true
      const fileStore = useFileStore()
      const deubgStore = useDebugStore()
      const appStore = useAppStore()
      deubgStore.clearLogs()
      deubgStore.addDebugLog({
        content: 'Begin deploying ' + files.join(', '),
      })
      deubgStore.addDebugLog({
        content: 'Runtime: ' + (appStore.currentApp?.runtime || '-'),
      })
      // todo add deploy log
      deubgStore.addDebugLog({
        content: 'Deploy log output...',
      })

      fileStore.updateFileByNames(files, {
        status: EnumFileStatus.Deploying,
      })
      let res: DeployResponse | undefined
      try {
        res = (await asyncAppSocketSend(WS_EVENT.FILE_UNDEPLOY, {
          functions: files,
          desc: this.changelog,
          all: !!this.deployAll,
        })) as DeployResponse
      } catch {}
      this.unDeployDone(files, res)
    },
    async unDeployDone(files: string[], res?: DeployResponse) {
      const fileStore = useFileStore()
      const deubgStore = useDebugStore()
      // TODO 调整判断
      if (res?.functions.length) {
        deubgStore.addDebugLog({
          content: 'Offline successed',
          level: 'success',
        })
        fileStore.setFiles({ functions: res.functions })
      } else {
        acMessage.error('Offline failed')
        deubgStore.addDebugLog({
          content: 'Offline failed',
          level: 'error',
        })
        fileStore.resetFiles(files)
      }
      this.deploying = false
    },
    async updateDeployHistory() {
      try {
        const res = await asyncAppSocketSend(WS_EVENT.APP_VERSION_LIST, { page: 1, pageSize: 50 })
        this.setDeployHisotry(res)
      } catch {}
    },
    setDeployHisotry(data: DeploymentHistory[]) {
      if (Array.isArray(data)) {
        this.deployHistoryLoading = false
        this.deployHistory = data
      }
    },
    async fetchOnlineDeployment() {
      this.onlineDeploymentDetailLoading = true;
      if (this.deployHistory.length === 0) {
        await this.updateDeployHistory();
      }
      const onlineHistory = this.deployHistory.find(deployment => deployment.status === DeployStatus.success);

      if (this.onlineDeploymentDetail?.versionNumber === onlineHistory?.versionNumber) {
        this.onlineDeploymentDetailLoading = false;
        return;
      }

      if (onlineHistory) {
        this.onlineDeploymentDetail = await asyncAppSocketSend<DeploymentHistory>(WS_EVENT.APP_VERSION_DETAIL, {
          version: onlineHistory.versionNumber,
        });
      }
      this.onlineDeploymentDetailLoading = false;
    },
    reset() {
      this.selectedFiles = []
      this.deployModalVisible = false
      this.deployAll = false
      this.changelog = ''
    },
  },
})
