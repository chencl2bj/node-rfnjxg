import { tour } from '@/components/guide/guide'
import { useLocalStorage } from '@vueuse/core'
import { defineStore } from 'pinia'
import { useSettingStore } from './setting'

const dashboardPath = '/dashboard'
const isDashboardPath = location?.pathname === dashboardPath

export const GuideStorageKey = 'ac-guide'
export enum GuideStatus {
  Init,
  Doing,
  Done,
}

type GuideState = {
  current: number
  status: GuideStatus
}

const cachedGuide = useLocalStorage(GuideStorageKey, {
  current: 0,
  status: GuideStatus.Done,
})

export const useGuideStore = defineStore('guide', {
  state: (): GuideState => ({
    current: 0,
    status: GuideStatus.Done,
  }),
  getters: {
    initModelVisible(state) {
      return state.status === GuideStatus.Init
    },
    isGuiding(state) {
      return state.status === GuideStatus.Doing
    },
  },
  actions: {
    init() {
      this.reset()
      this.status = GuideStatus.Init
    },
    start() {
      this.status = GuideStatus.Doing
      tour.start()
      this.saveCurrentStep(this.current)
      this.saveStatus(this.status)
      gtag('event', 'tutorial_begin')
    },
    exit() {
      this.reset()
    },
    checkStatus() {
      const settingStore = useSettingStore()
      const { guide } = settingStore.display
      if (this.isGuiding) {
        return
      }
      if (guide === GuideStatus.Init && isDashboardPath) {
        this.init()
      }
    },
    nextStep(saveToCache = true) {
      if (!this.isGuiding) return
      tour.next()
      this.current++
      if (saveToCache) {
        this.saveCurrentStep(this.current)
      }
    },
    saveCurrentStep(step: number) {
      cachedGuide.value.current = step
    },
    saveStatus(status: GuideStatus) {
      cachedGuide.value.status = status
    },
    updateStatus(status: GuideStatus = GuideStatus.Doing) {
      const settingStore = useSettingStore()
      if (settingStore.display.guide === GuideStatus.Doing) return
      settingStore.changeGuideStatus(status)
    },
    reset() {
      this.$reset()
      tour.complete()
      this.current = 0
      this.status = GuideStatus.Done
      // save
      this.saveCurrentStep(this.current)
      this.saveStatus(this.status)
    },
  },
})
