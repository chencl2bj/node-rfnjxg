import { RuntimeList } from '@/config'
import { router } from '@/router'
import {
  getApp,
  getAppList,
  IApp,
  updateApp,
  updateAppStar,
  deleteApp,
  IParamsCreateApp,
  createApp,
} from '@/services/app'
import { sleep } from '@/utils/helper'
import { asyncAppSocketSend, WS_EVENT } from '@/utils/websocket/appSocket'
import { defineStore } from 'pinia'
import { useGuideStore } from './guide'
import { getDefaultDisplay, SettingState } from './setting'

interface IAppState {
  modalCreateVisible: boolean
  appLoading: boolean
  appSettingsVisible: boolean
  deleteAppVisible: boolean
  creating: boolean
  appList: IApp[]
  currentApp: IApp
  editorSettings: SettingState['display']['editor']
}

export const useAppStore = defineStore('app', {
  state: (): IAppState => ({
    modalCreateVisible: false,
    appLoading: false,
    appSettingsVisible: false,
    deleteAppVisible: false,
    creating: false,
    appList: [],
    currentApp: {} as IApp,
    editorSettings: getDefaultDisplay().editor,
  }),
  getters: {
    favoriteApps(state) {
      return state.appList.filter((app) => app.star)
    },
    runtimeName(state) {
      const name = RuntimeList.find((r) => r.value === state.currentApp.runtime)
      return name?.label || 'Node.js'
    },
  },
  actions: {
    async initAppList() {
      if (this.appList.length <= 0) {
        this.appLoading = true
      }
      return getAppList()
        .then((res) => {
          this.appList = res.data
        })
        .finally(() => (this.appLoading = false))
    },
    toggleStar(app: IApp) {
      app.star = !app.star
      if (app.star) {
      }
      return updateAppStar(app.appId, app.star).catch(() => (app.star = !app.star))
    },
    async createApp(data: IParamsCreateApp) {
      this.creating = true
      return createApp(data)
        .then((res) => {
          router.push(`/dashboard/${res.data.appId}`)
          return res
        })
        .finally(() => {
          this.creating = false
          this.handleModalCreateVisible(false)
        })
    },
    handleModalCreateVisible(visible: boolean) {
      this.modalCreateVisible = visible
    },
    async getAppInfo(id: string) {
      const res = await getApp(id)
      this.currentApp = res.data
    },
    async readApp() {
      const res = await asyncAppSocketSend(WS_EVENT.APP_READ)
      this.currentApp = {
        ...this.currentApp,
        ...res,
      }
    },
    async updateCurrentApp(app: IApp) {
      this.currentApp = {
        ...this.currentApp,
        ...app,
      }
    },
    changeAppSettingsVisible(visible: boolean) {
      this.appSettingsVisible = visible
    },
    changeDeleteAppVisible(visible: boolean) {
      this.deleteAppVisible = visible
    },
    updateAppName(name: string) {
      updateApp(this.currentApp.appId, {
        name,
      }).then(() => (this.currentApp.name = name))
    },
    updateRuntime(runtime: string) {
      updateApp(this.currentApp.appId, {
        runtime,
      }).then(() => (this.currentApp.runtime = runtime))
    },
    updateTimeout(timeout: number) {
      updateApp(this.currentApp.appId, {
        funcTimeout: timeout,
      }).then(() => (this.currentApp.funcTimeout = timeout))
    },
    updateEditor() {
      updateApp(this.currentApp.appId, {
        editor: this.editorSettings,
      })
    },
    delete() {
      return deleteApp(this.currentApp.appId)
    },
    resetState() {
      this.currentApp = {} as IApp
    },
  },
})
