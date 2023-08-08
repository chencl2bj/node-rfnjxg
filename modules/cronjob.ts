import { asyncAppSocketSend, WS_EVENT } from '@/utils/websocket/appSocket'
import dayjs from 'dayjs'
import { defineStore } from 'pinia'

type Cronjob = {
  id?: string
  name: string
  startTime: dayjs.Dayjs
  functions: string[]
  repeatType: 'minute' | 'hour' | 'day' | 'month' | 'week' | 'once'
  repeatInterval: number
  endTime: dayjs.Dayjs | null | undefined
  enabled?: boolean
}

type CronjobStore = {
  addCronjobModalVisible: boolean
  tmpCronjob: Cronjob
  cronjobs: Cronjob[]
}

export const useCronjobStore = defineStore('cronjob', {
  state: (): CronjobStore => ({
    addCronjobModalVisible: false,
    tmpCronjob: {
      name: '',
      startTime: dayjs().add(1, 'minute').startOf('minute'),
      functions: [],
      repeatType: 'once',
      repeatInterval: 1,
      endTime: null,
    },
    cronjobs: [],
  }),
  getters: {},
  actions: {
    changeAddCronjobModalVisible(visible: boolean) {
      this.addCronjobModalVisible = visible
    },
    resetTmpCronjob() {
      this.tmpCronjob = {
        name: '',
        startTime: dayjs().add(1, 'minute').startOf('minute'),
        functions: [],
        repeatType: 'once',
        repeatInterval: 1,
        endTime: null,
      }
    },
    async createCronjob() {
      const startTime = this.tmpCronjob.startTime.startOf('minute').unix()
      const endTime = this.tmpCronjob?.endTime ? this.tmpCronjob.endTime.unix() : 0
      return await asyncAppSocketSend(WS_EVENT.CRONJOB_CREATE, {
        ...this.tmpCronjob,
        startTime,
        endTime,
      })
    },
    async updateCronjob() {
      const startTime = this.tmpCronjob.startTime.startOf('minute').unix()
      const endTime = this.tmpCronjob?.endTime ? this.tmpCronjob.endTime.unix() : 0
      return await asyncAppSocketSend(WS_EVENT.CRONJOB_UPDATE, {
        ...this.tmpCronjob,
        startTime,
        endTime,
      })
    },
    async deleteCronjob(id: string) {
      await asyncAppSocketSend(WS_EVENT.CRONJOB_DELETE, { id })
    },
    async listCronjob() {
      const { cronjobs } = await asyncAppSocketSend(WS_EVENT.CRONJOB_LIST)
      this.cronjobs = cronjobs
    },
  },
})
