import { AppVersionFunctionStatus, DeploymentHistory, getDefaultDeploymentHistory } from "@/services/app";
import { acMessage } from "@/utils/effect";
import { stringifyJSON } from "@/utils/helper";
import { asyncAppSocketSend, WS_EVENT } from "@/utils/websocket/appSocket";
import { differenceBy } from "lodash-es";
import { defineStore } from "pinia";

type PackageItem = {
  name: string
  version: string
}

type FileItem = {
  name: string
  content: string
  lastContent?: string
  status: AppVersionFunctionStatus
}

type DeploymentDetailState = {
  selectedVersion: number
  lastSuccessVersion: number
  modalVisible: boolean
  loading: boolean
  selectedFile: { type: FILE_TYPE, name: string }
  functions: FileItem[]
  configurations: FileItem[]
  changelog: FileItem
  createdAt: number
}

type FILE_TYPE = 'functions' | 'configurations' | 'changelog';

const getContentFromRecord = (record?: Record<string, any>) => {
  return record ? stringifyJSON(record) : ''
}

const getContentFromPackages = (packages: PackageItem[]) => {
  return packages.length > 0 ?
    getContentFromRecord(packages.reduce((res, cur) => {
      res[cur.name] = cur.version
      return res
    }, {} as Record<string, string>)) :
    ''
}

export const useDeploymentDetailStore = defineStore('deploymentDetail', {
  state: (): DeploymentDetailState => ({
    selectedVersion: 0,
    lastSuccessVersion: 0,
    modalVisible: false,
    loading: true,
    selectedFile: { type: 'functions', name: '' },
    functions: [],
    configurations: [],
    changelog: {
      name: 'Changelog',
      content: '',
      status: AppVersionFunctionStatus.Unchange,
    },
    createdAt: 0,
  }),
  getters: {
    changedFunctions(state) {
      return state.functions.filter(fn => fn.status !== AppVersionFunctionStatus.Unchange)
    },
    changedConfigurations(state) {
      return state.configurations.filter(fn => fn.status !== AppVersionFunctionStatus.Unchange)
    },
    selectedFileItem(state) {
      switch (state.selectedFile.type) {
        case 'functions':
          return state.functions.find(fn => fn.name === state.selectedFile.name)
        case 'configurations':
          return state.configurations.find(fn => fn.name === state.selectedFile.name)
        default:
          return undefined
      }
    }
  },
  actions: {
    async setVersion(selectedVersion: number, lastSuccessVersion?: number) {
      this.loading = true
      this.selectedVersion = selectedVersion
      this.lastSuccessVersion = lastSuccessVersion || 0
      
      try {
        // Get current and last version detail
        const promises = [
          asyncAppSocketSend<DeploymentHistory>(WS_EVENT.APP_VERSION_DETAIL, {
            version: selectedVersion,
          }),
        ]
        if (lastSuccessVersion) {
          promises.push(
            asyncAppSocketSend<DeploymentHistory>(WS_EVENT.APP_VERSION_DETAIL, {
              version: lastSuccessVersion,
            }),
          )
        }
        const res = await Promise.all(promises);
        const currentVersionRes = res[0]
        const lastSuccessVersionRes = res[1] || getDefaultDeploymentHistory()
        
        const deletedFunctions: FileItem[] = differenceBy<DeploymentHistory['functions'][number], DeploymentHistory['functions'][number]>(
          lastSuccessVersionRes.functions,
          currentVersionRes.functions,
          'name'
        ).map(fn => ({
          name: fn.name,
          content: '',
          lastContent: fn.content,
          status: AppVersionFunctionStatus.Deleted,
        }))

        this.functions = currentVersionRes.functions.map(fn => {
          const fileItem: FileItem = {
            ...fn,
            lastContent: '',
            status: AppVersionFunctionStatus.New
          }
          const lastFunc = lastSuccessVersionRes.functions.find(lf => lf.name === fn.name)
          if (lastFunc) {
            fileItem.lastContent = lastFunc.content
            fileItem.status = fn.content === lastFunc.content ? AppVersionFunctionStatus.Unchange : AppVersionFunctionStatus.Modify
          }
          return fileItem
        }).concat(deletedFunctions)
          .sort((f1, f2) => f1.name.localeCompare(f2.name))
        
        const curDeps = getContentFromPackages(currentVersionRes.packages)
        const lastDeps = getContentFromPackages(lastSuccessVersionRes.packages)
        const curEnvs = getContentFromRecord(currentVersionRes.env)
        const lastEnvs = getContentFromRecord(lastSuccessVersionRes.env)
        const curRuntime = getContentFromRecord({
          nodejs_version: currentVersionRes.runtime,
          function_execution_timeout: currentVersionRes.funcTimeout,
        })
        const lastRuntime = lastSuccessVersionRes.runtime ? getContentFromRecord({
          nodejs_version: lastSuccessVersionRes.runtime,
          function_execution_timeout: lastSuccessVersionRes.funcTimeout
        }) : ''
        this.configurations = [
          {
            name: 'Dependencies',
            content: curDeps,
            lastContent: lastDeps,
            status: curDeps === lastDeps ? AppVersionFunctionStatus.Unchange : AppVersionFunctionStatus.Modify
          },
          {
            name: 'Environments',
            content: curEnvs,
            lastContent: lastEnvs,
            status: curEnvs === lastEnvs ? AppVersionFunctionStatus.Unchange : AppVersionFunctionStatus.Modify
          },
          {
            name: 'Runtime',
            content: curRuntime,
            lastContent: lastRuntime,
            status: curRuntime === lastRuntime ? AppVersionFunctionStatus.Unchange : AppVersionFunctionStatus.Modify
          }
        ]

        this.changelog.content = currentVersionRes.desc
        this.createdAt = currentVersionRes.createdAt

        // Select first func
        if (this.changedFunctions.length > 0) {
          this.changeSelectedFile('functions', this.changedFunctions[0].name)
        } else if (this.changedConfigurations.length > 0) {
          this.changeSelectedFile('configurations', this.changedConfigurations[0].name)
        } else {
          this.changeSelectedFile('changelog', 'Changelog')
        }
      } catch (error: any) {
        acMessage.error(error.message || 'Load deployment details faild, Please try again later')
      } finally {
        this.loading = false;
      }
    },
    changeSelectedFile(type: FILE_TYPE, name: string = '') {
      this.selectedFile = { type, name }
    }
  },
})
