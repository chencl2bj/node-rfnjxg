import { defineStore } from 'pinia'
import { debounce, isEmpty } from 'lodash-es'
import { updateApp } from '@/services/app'
import { useAppStore } from './app'

export type Env = {
  key: string
  value: string
  isChanged?: boolean
  changedHint?: string
}

type EnvState = {
  loading: boolean
  envs: Env[]
}

export const useEnvStore = defineStore('env', {
  state: (): EnvState => ({
    loading: false,
    envs: [
      {
        key: '',
        value: '',
      },
    ],
  }),
  actions: {
    async setEnvs(env: Record<string, string>) {
      this.envs = isEmpty(env)
        ? [
          {
            key: '',
            value: '',
          },
        ]
        : Object.keys(env).map((i) => ({ key: i, value: env[i] }))
      this.addEmptyEnv()
      this.setEnvChangedStatus()
    },
    addEnv() {
      this.envs.push({
        key: '',
        value: '',
      })
    },
    updateEnv(index: number, header: Partial<Env>) {
      this.envs[index] = { ...this.envs[index], ...header }
      this.addEmptyEnv()
      this.setEnvChangedStatus()
      this.sendEnvUpdates(this.envs)
    },
    setEnvChangedStatus() {
      const appStore = useAppStore()
      const lastOnlineEnv = appStore.currentApp?.lastOnlineEnv
      this.envs = this.envs.map((env) => {
        if (!lastOnlineEnv || env.value !== lastOnlineEnv[env.key]) {
          if (env.key) {
            env.isChanged = true
            env.changedHint = 'This new env will take effect after deploying'
          }
        }
        return env
      })
    },
    addEmptyEnv() {
      if (this.envs[this.envs.length - 1].key !== '') {
        this.addEnv()
      }
    },
    deleteEnv(index: number) {
      if (this.envs.length <= 1) {
        return
      }
      this.envs.splice(index, 1)
      this.sendEnvUpdates(this.envs)
    },
    sendEnvUpdates: debounce((envs: Env[]) => {
      const appId = useAppStore().currentApp?.appId || ''
      updateApp(appId, {
        env: envs
          .filter((i) => !!i.key.trim())
          .reduce((res, cur) => {
            res[cur.key] = cur.value
            return res
          }, {} as Record<string, string>),
      })
    }, 600),
  },
})
