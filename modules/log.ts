import { defineStore } from 'pinia'
import dayjs from 'dayjs'
import { asyncAppSocketSend, WS_EVENT } from '@/utils/websocket/appSocket'
import { sleep } from '@/utils/helper'
import { acMessage } from '@/utils/effect'
import { IPageData } from '@/services/type'
import { logger } from '@/utils/debug'
import { nanoid } from 'nanoid'
import { formatDate } from '@/utils/date'

export enum LogFilter {
  ALL = 'all',
  ERROR = 'error',
}

export enum LogLevel {
  INFO = 'info',
  ERROR = 'error',
}

export type Interval = [dayjs.Dayjs | undefined, dayjs.Dayjs | undefined]

export interface ILog {
  id: string
  content: string
  logLevel: LogLevel
  time: number
  // 前端使用，标识暂停重新开始后的时间分隔线
  divider?: boolean,
  dividerLabel?: string,
}

interface ILogState {
  logs: ILog[]
  newLogsCount: number
  interval: Interval
  keyword: string
  filter: LogFilter
  isPaused: boolean
  inSearchingMode: boolean
  preLogLoading: boolean
  preLogEmpty: boolean
  /** 修改 rerenderKey 让 log 重新渲染计算是否要展示折叠箭头 */
  rerenderKey: number
}

function getOneDivider(time = Date.now(), dividerLabel = '') {
  return {
    id: nanoid(),
    content: '',
    time,
    logLevel: LogLevel.ERROR,
    divider: true,
    dividerLabel,
  }
}

export const useLogStore = defineStore('log', {
  state: (): ILogState => ({
    logs: [],
    newLogsCount: 0,
    interval: [undefined, undefined],
    keyword: '',
    filter: LogFilter.ALL,
    isPaused: false,
    inSearchingMode: false,
    preLogLoading: false,
    preLogEmpty: false,
    rerenderKey: 1,
  }),
  getters: {
    displayLogs(): ILog[] {
      switch (this.filter) {
        case LogFilter.ALL:
          return this.logs
        case LogFilter.ERROR:
          return this.logs.filter((l) => l.logLevel === LogLevel.ERROR)
        default:
          return this.logs
      }
    },
  },
  actions: {
    // Reset all states and load some logs
    init() {
      this.$reset();
      this.fetchPreviousLogs(5, false);
    },
    async fetchPreviousLogs(pageSize = 30, appendDivider = true) {
      this.preLogLoading = true
      try {
        const from = Math.max(
          dayjs().subtract(7, 'day').startOf('day').valueOf(),
          this.interval[0] ? this.interval[0].valueOf() : 0,
        );
        const to = Math.min(
          this.interval[1] ? this.interval[1].valueOf() : Date.now(),
          this.logs[0] ? this.logs[0].time : Date.now(),
        );
        const { data } = await asyncAppSocketSend<IPageData<ILog[]>>(WS_EVENT.ONLINE_LOG_LOAD, {
          from,
          to,
          keyword: this.keyword,
          pageSize,
        })
        // console.log('from', from, 'to', to);
        // console.log('received logs', data);
        let logs = data.filter(log => log.time < to).sort((l1, l2) => l1.time - l2.time);
        // console.log('sorted logs', logs);
        this.preLogEmpty = logs.length === 0
        if (logs.length > pageSize) {
          logs = logs.slice(0 - pageSize);
        }
        logs.forEach(log => log.id = nanoid());
        if (logs.length > 0) {
          // If the first one is a log and not a divider, we append a divider to new logs
          if (this.logs[0] && !this.logs[0].divider && appendDivider) {
            // First, remove the last divider if exists
            const firstDividerIndex = this.logs.findIndex(log => log.divider && !log.dividerLabel);
            if (firstDividerIndex >= 0) {
              this.logs.splice(firstDividerIndex, 1);
            }
            logs.push(getOneDivider(logs[logs.length - 1].time))
          }
          this.logs = logs.concat(this.logs);
        }
      } catch (error) {
        acMessage.error('Load pre log failed') 
      } finally {
        this.preLogLoading = false
      }
    },
    pause() {
      this.isPaused = true;
      const now = Date.now();
      this.logs.push(getOneDivider(
        now,
        `Paused at ${formatDate(now, false, 'HH:mm:ss.SSS')}`,
      ));
    },
    resume() {
      const now = Date.now();
      this.logs.push(getOneDivider(
        now,
        `Resumed at ${formatDate(now, false, 'HH:mm:ss.SSS')}`,
      ));
      this.isPaused = false;
    },
    clear() {
      this.logs = []
      this.preLogEmpty = false
    },
    checkSearchingMode() {
      // Keyword is empty and date range is not set
      if (this.keyword === '' && !this.interval[0] && !this.interval[1]) {
        if (this.inSearchingMode) {
          this.init();
        }
      } else {
        this.inSearchingMode = true;
        this.logs = [];
        this.preLogEmpty = false;
        this.isPaused = true;
        this.fetchPreviousLogs();
      }
    },
    updateFilter(level: LogFilter) {
      this.filter = level
    },
    addLogs(logs: ILog[]) {
      this.newLogsCount += logs.length;
      this.logs.push(...logs)
    },
  },
})
