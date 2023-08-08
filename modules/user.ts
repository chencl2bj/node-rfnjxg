import { router } from '@/router'
import {
  deleteSessions,
  getSessions,
  getThirdPartAccounts,
  getUserInfo,
  ISessionResp,
  IUser,
  logout,
  ThirdPartAccount,
} from '@/services/user'
import { localForage } from '@/utils/localforage'
import { parseUA } from '@/utils/ua'
import { useLocalStorage } from '@vueuse/core'
import { defineStore } from 'pinia'
import type UAParser from 'ua-parser-js'
import { useSettingStore } from '@/store/modules/setting'

interface ISession extends UAParser.IResult, Omit<ISessionResp, 'device'> {}

interface IUserState {
  user: IUser | null
  sessions: ISession[]
  thirdPartAccounts: ThirdPartAccount[]
}

export function getUser() {
  // @ts-ignore
  return JSON.parse(localStorage.getItem('user') || null) || null
}
export function setUser(v: IUser) {
  return localStorage.setItem('user', JSON.stringify(v))
}

export const useUserStore = defineStore('user', {
  state: (): IUserState => ({
    user: null,
    sessions: [],
    thirdPartAccounts: [],
  }),
  getters: {
    isLogin(state) {
      return !!state.user?.name
    },
  },
  actions: {
    setUser(data: IUser | null) {
      this.user = data
    },
    async getUser() {
      try {
        const res = await getUserInfo()
        this.setUser(res.data)
        gtag('set', {
          'user_id': `${res.data.uid}`,
        });
        useSettingStore().fetchSettings()
      } catch (error) {
        throw error
      }
    },
    async login() {},
    async logout() {
      try {
        await logout()
      } finally {
        this.redirectToLogin()
      }
    },

    redirectToLogin() {
      const { path } = router.currentRoute.value;
      if (path.startsWith('/login') || path.startsWith('/signup')) {
        return;
      }

      router.replace('/login');
      localForage.clear()
      this.setUser(null)
      this.$reset()
    },
    async fetchSessions() {
      const res = await getSessions()
      this.sessions = res.data.map((item) => {
        const result = parseUA(item.device)
        return {
          activedAt: item.createdAt,
          ...item,
          ...result,
        }
      }).sort((s1, s2) => s2.activedAt - s1.activedAt);
    },
    async fetchThirdPartAccounts() {
      const res = await getThirdPartAccounts()
      this.thirdPartAccounts = res.data
    },
    async deleteSessions(sessionId: string) {
      return deleteSessions(sessionId)
    },
  },
})
