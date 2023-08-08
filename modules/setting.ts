import { DEFAULT_LOCALE } from '@/config'
import { getCurrentMode, mode } from '@/hooks/theme'
import { getApp, getAppList, IApp, updateAppStar } from '@/services/app'
import { getSettings, updateSettings } from '@/services/setting'
import { getDefaultTimezone, setTimezone } from '@/utils/date'
import { acMessage } from '@/utils/effect'
import { BasicColorSchema } from '@vueuse/core'
import { defineStore } from 'pinia'
import { useGuideStore } from './guide'

export type SettingState = {
  display: {
    theme: string
    language: string
    timezone: string
    editor: {
      indent: {
        type: string
        size: number
      }
    },
    guide: number
  }
}

export const getDefaultDisplay = () => ({
  theme: mode.value,
  language: DEFAULT_LOCALE,
  timezone: getDefaultTimezone(),
  // timezone: 8,
  editor: {
    indent: {
      type: 'tab',
      size: 2,
    },
  },
  guide: 0,
})

export const useSettingStore = defineStore('setting', {
  state: (): SettingState => ({
    display: getDefaultDisplay(),
  }),
  actions: {
    async fetchSettings() {
      const res = await getSettings()
      const theme = res.data.theme === 'default' ? 'auto' : res.data.theme
      this.display = Object.assign(getDefaultDisplay(), res.data, {
        theme,
      })
      mode.value = theme as BasicColorSchema
      setTimezone(this.display.timezone)
      const guideStore = useGuideStore()
      guideStore.checkStatus()
    },
    async updateSettings() {
      updateSettings({ ...this.display, theme: getCurrentMode(this.display.theme) }).catch(() => {
        acMessage.error('Settings update failed')
      })
    },
    async changeTheme(theme: string) {
      if (!theme) return
      mode.value = theme as BasicColorSchema
      this.display.theme = theme
      this.updateSettings()
    },
    async changeLanguage(val: string) {
      this.display.language = val
      this.updateSettings()
    },
    async changeTimezone(val: string) {
      this.display.timezone = val
      setTimezone(this.display.timezone)
      this.updateSettings()
    },
    async changeEditorIndentType(type: string) {
      this.display.editor.indent.type = type
      this.updateSettings()
    },
    async changeEditorIndentSize(size: number) {
      this.display.editor.indent.size = size
      this.updateSettings()
    },
    async changeGuideStatus(status: number) {
      this.display.guide = status
      this.updateSettings()
    },
  },
})
