import { defineStore } from 'pinia'
import { asyncAppSocketSend, WS_EVENT } from '@/utils/websocket/appSocket'
import { useAppStore } from './app'
import { useFileStore } from './file'

interface ITrashFile {
  _id: string
  appId: string
  name: string
  path: string
  createdAt: string
  updatedAt: string
}

type TrashStore = {
  trashModalVisible: boolean
  isTrashFilesLoading: boolean
  trashFiles: ITrashFile[]
  currTrashFileId: string
  currTrashFileName: string
  currTrashFileContent: string
  isCurrTrashFileContentLoading: boolean
}

export const useTrashStore = defineStore('trash', {
  state: (): TrashStore => ({
    trashModalVisible: false,
    isTrashFilesLoading: false,
    trashFiles: [],
    currTrashFileId: '',
    currTrashFileName: '',
    currTrashFileContent: '',
    isCurrTrashFileContentLoading: false,
  }),
  actions: {
    changeModalVisible(visible: boolean) {
      this.trashModalVisible = visible
    },
    setCurrTrashFileId(id: string) {
      this.currTrashFileId = id
    },
    setcurrTrashFileName(name: string) {
      this.currTrashFileName = name
    },
    async getTrashFiles() {
      const appId = useAppStore().currentApp?.appId || ''
      if (!appId) {
        return
      }
      this.isTrashFilesLoading = true
      const res = await asyncAppSocketSend(WS_EVENT.TRASH_FUNC_LIST)
      this.trashFiles = res.data
      if (res.data?.length) {
        const { _id, name } = res.data[0]
        this.currTrashFileId = _id
        this.currTrashFileName = name
        this.getTrashFile(_id)
      }
      this.isTrashFilesLoading = false
    },
    async getTrashFile(_id: string) {
      this.isCurrTrashFileContentLoading = true
      const res = await asyncAppSocketSend(WS_EVENT.TRASH_FUNC_READ, { _id })
      this.currTrashFileContent = res?.content
      this.isCurrTrashFileContentLoading = false
    },
    async restoreTrashFile(_id: string) {
      await asyncAppSocketSend(WS_EVENT.TRASH_FUNC_RECOVER, { _id })
      const fileStore = useFileStore()
      fileStore.updateFiles()
      this.trashFiles = this.trashFiles.filter((file) => file._id !== _id)
      if (this.currTrashFileId === _id) {
        this.currTrashFileId = ''
        this.currTrashFileName = ''
        this.currTrashFileContent = ''
      }
    },
  },
})
