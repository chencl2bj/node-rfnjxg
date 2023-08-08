import { appSocketSend, asyncAppSocketSend, WS_EVENT } from '@/utils/websocket/appSocket'
import { EnumFileStatus, IFile } from '@/services/file'
import { logger } from '@/utils/debug'
import { defineStore } from 'pinia'
import { get } from 'lodash-es'
import { router } from '@/router'
import { useAppStore } from './app'
import { getQuery, acMessage } from '@/utils/effect'
import { useLocalStorage } from '@vueuse/core'
import { useDebugStore } from './debug'
import { editor } from './workbench'
import { localForage, getFileKey } from '@/utils/localforage'
import { delayRun } from '@/utils/helper'
import { getInvokeUrl } from '@/utils/file'
import { defaultJSFuncContent, guideJSFuncContent } from '@/config/constant'
import { useGuideStore } from './guide'

interface IFileState {
  files: Record<string, IFile>
  filename: string
  filesLoading: boolean
  isOpeningFile: boolean // 正在打开文件
  /** 临时记录文件编辑 */
  editCounter: number
}

export const useFileStore = defineStore('file', {
  state: (): IFileState => ({
    files: {},
    filename: '',
    filesLoading: true,
    isOpeningFile: false,
    editCounter: 0,
  }),
  getters: {
    currentFile(state) {
      return state.files ? state.files[state.filename] : null
    },
    fileList(state) {
      return Object.values(state.files || {})
    },
    fileNames(state) {
      return Object.keys(state.files || {})
        .filter((name) => Boolean(name)) // 过滤文件列表偶现的 undefined，暂没有找到稳定复现路径
        .sort()
    },
    runnableFileNames(state): string[] {
      return this.fileNames.filter((name) => state.files[name].status === EnumFileStatus.Deployed)
    },
    currentInvokeURL() {
      const appStore = useAppStore()
      // @ts-ignore
      return getInvokeUrl(this.currentFile?.name || '', appStore.currentApp?.invokeUrl || '')
    },
  },
  actions: {
    async changeFile(name: string) {
      if (!name) {
        return
      }
      const appStore = useAppStore()
      const appId = appStore.currentApp?.appId
      if (!appId) {
        return
      }
      this.filename = name

      // read code in local
      const local = (await localForage.get(this.getLocalKey(name))) as IFile
      const localUpdatedAt = local?.localUpdatedAt || 0
      const localContent = local?.content
      let file: IFile | undefined
      if (localContent !== undefined) {
        editor.open(name, localContent)
        router.replace(`/dashboard/${appId}?file=${name}`)
        setCachedSelectedFile(appId, name)
        file = await this.getFileInfo(name)
      } else {
        // if there is no local, delay show loading
        file = await delayRun(this.getFileInfo(name), () => (this.isOpeningFile = true))
      }
      this.isOpeningFile = false

      const content = file?.content
      const updatedAt = new Date(file?.updatedAt || 0).getTime()
      // if local code is stale
      // if network is slow and user switches file frequently, current file may not be the res file
      if (localUpdatedAt < updatedAt && content && file?.name === this.filename) {
        editor.open(name, content)
        router.replace(`/dashboard/${appId}?file=${name}`)
        setCachedSelectedFile(appId, name)
      }

      // if local code is newer, then update remote file
      if (localUpdatedAt > updatedAt && content && localContent) {
        this.writeFileBefore(name, localContent)
      } else if (!localUpdatedAt && content) {
        this.updateFileByNames([name], { content })
      }
    },
    async updateFiles() {
      const res = await asyncAppSocketSend<{ functions: IFile[] }>(WS_EVENT.FILE_LIST, {
        verbose: true,
      })
      this.setFiles(res)
    },
    setFiles(payload: { functions: IFile[] }) {
      this.filesLoading = false
      const files = get(payload, 'functions', []) as IFile[]
      this.files = files.reduce((obj, cur) => {
        // const item = get(this.files, cur.name, {})
        obj[cur.name] = { ...cur, preStatus: cur.status }
        this.saveToLocal(cur.name, obj[cur.name])
        return obj
      }, {} as Record<string, IFile>)
      this.initCurrentFile()
    },
    async saveToLocal(name: string, file: IFile) {
      const key = this.getLocalKey(name)
      const local = await localForage.get(key)
      const localUpdatedAt = local?.localUpdatedAt || 0
      const updatedAt = new Date(file?.updatedAt || 0).getTime()
      // local version is newer
      if (localUpdatedAt > updatedAt) {
        return
      }
      localForage.set(this.getLocalKey(name), file)
    },
    initCurrentFile() {
      if (this.filename) {
        return
      }

      let file = getQuery('file')
      const appStore = useAppStore()
      const appId = appStore.currentApp?.appId || ''
      if (!file) {
        file = getCachedSelectedFile(appId).value || this.fileList[0]?.name
      }
      this.changeFile(file)
    },
    async getFileInfo(name: string) {
      try {
        const res = await asyncAppSocketSend<IFile>(WS_EVENT.FILE_GET, { name })
        this.getFileAfter(res)
        return res
      } catch (error) {
        console.error(error)
      }
    },
    getFileAfter(payload: IFile) {
      const file = this.files[payload.name]
      if (!file || !payload) {
        return
      }
      const debugStore = useDebugStore()
      debugStore.updateOnlineRequests(payload.onlineRequest)
      this.files[file.name] = {
        ...file,
        ...payload,
      }
    },
    writeFileOrAdd(name: string, content: string) {
      // createdAt value '' means the file has not been added
      if (this.files[name].createdAt) {
        // added
        this.writeFileBefore(name, content)
      } else {
        // added failed, try to add again
        this.addFileBefore(name, content)
      }
    },
    async addFileBefore(name: string, content = defaultJSFuncContent) {
      // it takes several seconds to create new file in bad network connection
      // or event failed to create new file
      // store file in local first
      // when file content updates, which function to call is depended on createdAt value

      // guide
      const guideStore = useGuideStore()
      if (guideStore.isGuiding) {
        content = guideJSFuncContent
      }

      const newFile = createTmpFile(name, { content })
      this.files[name] = newFile
      await localForage.set(this.getLocalKey(name), newFile)
      this.changeFile(name)
      return asyncAppSocketSend(WS_EVENT.FILE_CREATE, { name, content }).then((file: IFile) => {
        let _file = file
        const { content } = this.files[name]
        if (content) {
          _file = { ..._file, content }
        }
        this.addFileAfter(_file)
      })
    },
    addFileAfter(file: IFile) {
      this.files[file.name] = { ...file, status: EnumFileStatus.Init }
    },
    writeFileBefore(name: string, content: string) {
      this.updateFileByNames([name], { content })
      appSocketSend(WS_EVENT.FILE_WRITE, { name, content })
      this.editCounter++
    },
    writeFileAfter(file: IFile) {
      logger.log('[write file done] ', file.content)
      this.editCounter--
      this.updateFileByNames([file.name], { ...this.files[file.name], ...file })
    },
    async renameFile(newName: string, oldName: string) {
      // rename:
      // 1. delete old file
      // 2. create new file with new name

      const content = this.files[oldName]?.content
      this.deleteFileBefore(oldName)

      // clear selected file in router
      router.replace({ query: { file: undefined } })
      try {
        await this.addFileBefore(newName, content)
      } catch (error) {
        acMessage.error('Failed to renamed')
      }
    },
    deleteFileBefore(name: string) {
      const file = this.files[name]
      if (!file) {
        acMessage.error('file not found')
        return
      }
      this.files[name] = { ...file, loading: true }
      appSocketSend(WS_EVENT.FILE_DEL, { name })
    },
    deleteFileAfter(file: IFile) {
      logger.log('[delete file done] ', file)
      const _file = this.files[file.name]
      if (file.status === EnumFileStatus.Deleted && ![EnumFileStatus.Offline, EnumFileStatus.Init].includes(_file?.status)) {
        this.updateFileByNames([file.name], { status: file.status, loading: false })
      } else {
        this.deleteByName(file.name)
      }
    },
    updateFileByNames(filenames: string[], payload: Partial<IFile>) {
      filenames.forEach((name) => {
        const file = { ...this.files[name], ...payload, localUpdatedAt: Date.now() }
        this.files[name] = file
        // save code to IndexedDB
        localForage.set(this.getLocalKey(name), file)
      })
    },
    deleteByName(name: string) {
      delete this.files[name]

      const appStore = useAppStore()
      const appId = appStore.currentApp?.appId || ''
      localForage.remove(`${appId}_${name}`)
    },
    getLocalKey(name: string) {
      const appStore = useAppStore()
      const appId = appStore.currentApp?.appId || ''

      return getFileKey(appId, name)
    },
    resetFiles(filenames: string[]) {
      filenames.forEach((name) => {
        this.files[name] = {
          ...this.files[name],
          status: this.files[name].preStatus,
          isDeploying: false,
        }
      })
    },
  },
})

function createTmpFile(name: string, options: Partial<IFile> = {}): IFile {
  return {
    name,
    status: EnumFileStatus.Init,
    preStatus: EnumFileStatus.Init,
    content: defaultJSFuncContent,
    createdAt: '',
    updatedAt: '',
    loading: false,
    onlineRequest: [],
    ...options,
  }
}

function getCachedSelectedFile(appId = '') {
  return useLocalStorage(`ac-ide-selected-file-${appId}`, '')
}
function setCachedSelectedFile(appId = '', name = '') {
  const selected = useLocalStorage(`ac-ide-selected-file-${appId}`, '')
  selected.value = name
  return selected
}

/**
 * 是否部署过
 */
export function isDeployed(status: `${EnumFileStatus}`) {
  return status === 'online' || status === 'renamed' || status === 'modified'
}

export function canRename(status: `${EnumFileStatus}`) {
  return status !== 'deleted' && status !== 'deploying'
}

export function canDelete(status: `${EnumFileStatus}`) {
  return status !== 'deleted' && status !== 'deploying'
}
