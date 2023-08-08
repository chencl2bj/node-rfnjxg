import { TimeoutNPM } from '@/config/constant'
import { actionCurrentTab } from '@/pages/workbench/hooks'
import { DebugLog } from '@/services/app'
import {
  DependencyStatus,
  getDependenciesVersions,
  IDependency,
  IDependencyVersions,
  InstalledDependency,
} from '@/services/dependency'
import { acMessage, nprogress } from '@/utils/effect'
import {
  appSocketListener,
  appSocketSend,
  asyncAppSocketSend,
  genMsgId,
  WS_EVENT,
} from '@/utils/websocket/appSocket'
import { keyBy, sortBy } from 'lodash-es'
import { defineStore } from 'pinia'
import { useDebugStore } from './debug'
import { editor } from './workbench'

type DependencyState = {
  dependencies: InstalledDependency[]
  selectedDependencies: Record<string, IDependency>
  loading: boolean
  installing: boolean
  dependenciesVersions: Record<string, IDependencyVersions>
}

export const DefaultDependencies = ['aircode']

export const useDependencyStore = defineStore('dependency', {
  state: (): DependencyState => ({
    dependencies: [],
    loading: true,
    selectedDependencies: {},
    installing: false,
    dependenciesVersions: {},
  }),
  getters: {
    dependenciesMap(state) {
      return keyBy(state.dependencies, 'name')
    },
    sortedDependencies(state) {
      const defaultInstalled = DefaultDependencies.map((name) =>
        state.dependencies.find((dep) => dep.name === name)
      ).filter(Boolean)
      const deps = sortBy(state.dependencies, (dep) => {
        return dep.name
      }).filter((dep) => !DefaultDependencies.includes(dep.name))
      return defaultInstalled.concat(deps) as InstalledDependency[]
    },
  },
  actions: {
    setList({ list }: { list: InstalledDependency[] }) {
      this.loading = false
      this.dependencies = list || []
      this.addInternalNpmDts(list)
      this.getDepsVersions(list.map((d) => d.name))
    },
    async addDep(deps: InstalledDependency[]) {
      this.installing = true
      nprogress.inc(0.5)
      // 切换到 Console 面板
      actionCurrentTab.value = 'console'
      const deubgStore = useDebugStore()
      const installedDepsName = this.dependencies.map((dep) => dep.name)
      const installedDepsVersion = this.dependencies.map((dep) => dep.version)
      const newDeps: InstalledDependency[] = []
      // aircode
      deps.forEach((dep) => {
        if (installedDepsName.includes(dep.name)) {
          this.updateDep(dep.name, { ...dep, status: DependencyStatus.Installing })
        } else {
          newDeps.push({ ...dep, status: DependencyStatus.Installing })
        }
      })
      // new dep first
      this.dependencies.unshift(...newDeps)
      const newDepsName = newDeps.map((dep) => dep.name)
      const msgId = genMsgId()
      deubgStore.clearLogs()
      const removeListener = appSocketListener(
        WS_EVENT.DEBUG_LOG,
        (log: DebugLog) => {
          deubgStore.addServerLog(log)
        },
        msgId,
        true
      )

      // filter installed dependencies
      const newDependencies = this.dependencies.filter(dep =>
      (!installedDepsName.includes(dep.name)
        || (installedDepsName.includes(dep.name) && installedDepsVersion[installedDepsName.indexOf(dep.name)] !== dep.version)))
        .map((dep) => {
          return {
            name: dep.name,
            version: dep.version,
          }
        })

      try {
        if (newDependencies.length) {
          await asyncAppSocketSend(
            WS_EVENT.DEP_INSTALL,
            {
              dependencies: newDependencies
            },
            TimeoutNPM,
            msgId
          )
        }
        this.dependencies = this.dependencies.map((dep) => {
          if (newDepsName.includes(dep.name) || installedDepsName.includes(dep.name)) {
            return {
              ...dep,
              status: DependencyStatus.Installed,
            }
          }
          return dep
        })
        this.addInternalNpmDts(this.dependencies)
      } catch (error) {
        acMessage.error('npm install failed')
        this.dependencies = this.dependencies.filter(
          (dep) => dep.status !== DependencyStatus.Installing
        )
      } finally {
        this.installing = false
        nprogress.done();
        setTimeout(() => {
          removeListener.dispose()
        }, 500)
      }
    },
    async removeDep(name: string) {
      nprogress.inc(0.5)
      this.updateDep(name, { status: DependencyStatus.UnInstalling })
      actionCurrentTab.value = 'console'
      const deubgStore = useDebugStore()
      const msgId = genMsgId()
      deubgStore.clearLogs()
      const removeListener = appSocketListener(
        WS_EVENT.DEBUG_LOG,
        (log: DebugLog) => {
          deubgStore.addServerLog(log)
        },
        msgId,
        true
      )
      try {
        await asyncAppSocketSend(
          WS_EVENT.DEP_UNINSTALL,
          { dependency: { name } },
          TimeoutNPM,
          msgId
        )
        this.dependencies = this.dependencies.filter((dep) => dep.name !== name)
      } catch (error) {
        this.updateDep(name, { status: DependencyStatus.Installed })
        acMessage.error('npm uninstall failed')
      } finally {
        nprogress.done()
        setTimeout(() => {
          removeListener.dispose()
        }, 500)
      }
    },
    removeDepDone(deps: InstalledDependency[]) {
      this.dependencies = deps
    },
    updateDep(name: string, payload: Partial<InstalledDependency>) {
      this.dependencies = this.dependencies.map((dep) => {
        if (dep.name === name) {
          return {
            ...dep,
            ...payload,
          }
        }
        return dep
      })
    },
    selectDep(name: string, version: string, dep: IDependency) {
      if (this.selectedDependencies[name] && this.selectedDependencies[name].version === version) {
        delete this.selectedDependencies[name]
      } else {
        this.selectedDependencies[name] = dep
        this.selectedDependencies[name].version = version
      }
    },
    getDepsVersions(depsNames: string[]) {
      return getDependenciesVersions(depsNames).then((res) => {
        this.dependenciesVersions = keyBy(res.data, 'name')
      })
    },
    addInternalNpmDts(deps: InstalledDependency[]) {
      const installed = DefaultDependencies.map((name) =>
        deps.find((dep) => dep.name === name)
      ).filter(Boolean)
      if (!installed.length) return
      installed.forEach((d) => d && editor.addExtraLib(d.name, d.version))
    },
  },
})
