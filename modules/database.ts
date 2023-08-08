import { asyncAppSocketSend, WS_EVENT } from '@/utils/websocket/appSocket'
import { defineStore } from 'pinia'
import {
  ITable,
  ITableData,
  describeTables,
  addTable,
  QueryData,
  Filter,
  queryTableData,
  updateTableData,
  addTableData,
  IndexType,
  addTableIndex,
  describeTableIndexes,
  IndexResp,
  FieldIndexType,
  getTableInfo,
  TableInfo,
} from '@/services/database'
import { debug } from 'debug'
import { acMessage } from '@/utils/effect'
import { flatten } from 'lodash-es'
import { deserializeDBField } from '@/utils/bson-helper'
import { formatDate } from '@/utils/date'

// const log = debug('ac:store:modules:database')
function log(...args: any[]) {}

export type IndexDataType = {
  name: string
  type: IndexType
  unique: boolean
  desc: string
  fields: {
    key: string
    value: FieldIndexType
  }[]
}
type DatabaseState = {
  inited: boolean
  modalCreateVisible: boolean
  modalCreateIndexVisible: boolean
  modalDeleteVisible: boolean
  modalAddFieldVisible: boolean
  modalUpdateFieldVisible: boolean
  modalDataPreviewVisible: boolean
  tables: ITable[]
  total: number
  dataPreviewIndex: number
  tableData: ITableData[]
  tableDataLoading: boolean
  tableIndexData: IndexResp[]
  currentTable: string
  tableInfo: TableInfo | null
  editTableRow: {
    _id: string | number | null
    field: string | null
  }
  condition: IConditionData
  filters: Record<string, Filter[]>
  showNewCondition: boolean
  newCondition: Filter
  newIndexData: IndexDataType
}

interface IConditionData {
  sort: Record<string, 1 | -1>
  page: number
  pageSize: number
}

function initIndexData(): IndexDataType {
  return {
    name: '',
    type: IndexType.Regular,
    unique: false,
    desc: '',
    fields: [
      {
        key: '',
        value: 1,
      },
    ],
  }
}

function initCondition(): IConditionData {
  return {
    sort: {
      createdAt: -1,
    },
    page: 1,
    pageSize: 10,
  }
}

export const useDatabaseStore = defineStore('database', {
  state: (): DatabaseState => ({
    inited: false,
    modalCreateVisible: false,
    modalCreateIndexVisible: false,
    modalDeleteVisible: false,
    modalAddFieldVisible: false,
    modalUpdateFieldVisible: false,
    modalDataPreviewVisible: false,
    showNewCondition: false,
    tableDataLoading: false,
    newIndexData: initIndexData(),
    tables: [],
    currentTable: '',
    tableInfo: null,
    newCondition: {
      operator: '',
      field: '',
      value: '',
    },
    editTableRow: {
      _id: '',
      field: '',
    },
    total: 0,
    dataPreviewIndex: 0,
    tableData: [],
    tableIndexData: [],
    condition: initCondition(),
    filters: {},
  }),
  getters: {
    // currentTable(state) {
    //   return 'table_a'
    // },
    queryCondition(state): QueryData {
      // const filter = state.condition.filter.map((item) => {
      //   return {
      //     operator: item.operator,
      //     field: item.field,
      //     value: item.type === 'string' ? `${item.value}` : parseInt(item.value, 10),
      //   }
      // })
      return {
        tableName: state.currentTable || '',
        ...state.condition,
        filter: flatten(Object.values(state.filters)),
      }
    },
    fields(state) {
      const keys = ['_id']
      this.tableData.forEach((item) => {
        Object.keys(item).forEach((_key: string) => {
          if (!keys.includes(_key)) {
            keys.push(_key)
          }
        })
      })
      return keys
    },
    loadingTables(state) {
      return !state.inited
    },
    // TODO 需要接口返回当前页码
    page(state) {
      const totalPage = Math.max(Math.ceil(state.total / state.condition.pageSize), 1)
      return Math.min(state.condition.page, totalPage)
    },
    tableSchema(state) {
      return state.tableInfo?.schema || {}
    },
    dataPreview(state) {
      return state.tableData.map((item) => ({
        ...item,
        createdAt: formatDate(item.createdAt, true),
        updatedAt: formatDate(item.updatedAt, true),
      }))[state.dataPreviewIndex]
    },
  },
  actions: {
    handleModalDeleteVisible(visible: boolean) {
      log('modalDeleteVisible', visible, this.modalDeleteVisible)
      this.modalDeleteVisible = visible
    },
    changeTable(name: string) {
      this.currentTable = name
      this.resetFilters()
      this.condition = initCondition()
      this.total = 0
      this.queryData()
      this.getIndexData()
    },
    resetFilters() {
      this.filters = {}
    },
    handleDataPreviewIndex(index: number) {
      this.dataPreviewIndex = index
    },
    handleDataPreview(index: number) {
      this.handleDataPreviewIndex(index)
      this.handleModalDataPreviewVisible(true)
    },
    handleDataPreviewPre() {
      const index = this.dataPreviewIndex - 1
      if (index < 0) {
        return
      }
      this.handleDataPreviewIndex(index)
    },
    handleDataPreviewNext() {
      const index = this.dataPreviewIndex + 1
      if (index > this.tableData.length - 1) {
        return
      }
      this.handleDataPreviewIndex(index)
    },
    setEdit(_id: string, field: string) {
      this.editTableRow = {
        _id,
        field,
      }
    },
    async getIndexData() {
      const res = await describeTableIndexes({
        tableName: this.currentTable,
      })

      this.tableIndexData = res
    },
    updateNewIndexData(index: number, oldVal: string | number, $e: any) {
      const fieldName = typeof $e !== 'object' ? $e : $e.target.value

      this.newIndexData.fields[index].key = fieldName
    },
    updateFieldIndexType(index: number, type: FieldIndexType) {
      this.newIndexData.fields[index].value = type
    },
    updateIndexData(_k: string, $e: any) {
      const value = typeof $e === 'string' ? $e : $e.target.value

      // @ts-ignore
      this.newIndexData[_k] = value
    },
    resetIndexData() {
      this.newIndexData = initIndexData()
    },
    updateIndexDataUnique($e: any) {
      const checked = typeof $e === 'string' ? $e : $e.target.checked
      // @ts-ignore
      this.newIndexData.unique = !!checked
    },
    updateIndexDataType($e: any) {
      const checked = typeof $e === 'string' ? $e : $e.target.checked
      log('updateIndexDataType value', checked)
      // @ts-ignore
      this.newIndexData.type = checked ? IndexType.D2Sphere : IndexType.Regular
    },
    addNewIndexField() {
      const fields = this.fields
      this.newIndexData.fields.push({ key: 'custome', value: 1 })
    },
    delNewIndexField(index: number) {
      delete this.newIndexData.fields[index]
    },
    clearCondition() {},
    clearEdit() {
      this.editTableRow = {
        _id: null,
        field: null,
      }
    },
    async createIndex() {
      log('createIndex', this.newIndexData)
      const res = await addTableIndex({
        tableName: this.currentTable || '',
        ...this.newIndexData,
        field: this.newIndexData.fields.reduce((res, cur) => {
          res[cur.key] = cur.value
          return res
        }, {} as Record<string, FieldIndexType>),
      })
      log('createIndex end', res)
      return res
    },
    addIndex(index: IndexResp) {
      this.tableIndexData.unshift(index)
    },
    deleteIndexByIndex(index: number) {
      this.tableIndexData.splice(index, 1)
    },
    createData(fields: string[] = ['_id']) {
      // this.editTableRow = {
      //   _id: '',
      //   field: fields[1] || '',
      // }
      // this.tableData.unshift({
      //   _id: '',
      // })
      this.insertData({})
    },
    updateData(id: string, field: string, $e: any, oldVal: unknown) {
      const type = this.tableSchema[field]
      const input = $e.target.value
      const { ok, value } = deserializeDBField(type, input)
      this.clearEdit()

      if (id === '') {
        this.insertData({
          [field]: value,
        })
      } else {
        if (!ok) {
          acMessage.error(`The value must be ${type}`)
        }
        if (!ok) {
          return
        }
        updateTableData({
          tableName: this.currentTable,
          _id: id,
          key: field,
          // @ts-ignore
          value,
        })
        this.tableData.forEach((item) => {
          if (item._id === id) {
            item[field] = value
          }
        })
      }
    },
    async insertData(data: any) {
      log('insertData', data)
      const res = await addTableData({
        tableName: this.currentTable,
        data,
      })
      const _tableData = this.tableData.filter((item) => {
        return item._id !== ''
      })
      // _tableData.unshift(res.data[0])
      // this.tableData = _tableData
      this.queryData()
      log('insertData 2', res.data, _tableData)
    },
    deleteDataByIds(tableName: string, ids: string[]) {
      if (tableName === this.currentTable && ids.length) {
        this.tableData = this.tableData.filter((item) => !ids.includes(item._id))
        this.total -= ids.length
        this.queryData()
      }
    },
    appendToFilters(field: string, filters: Filter[]) {
      this.filters[field] = filters
    },
    addFilterCondition() {},
    updateCondition(idx: number, _k: string, $e: any) {},
    removeFilterCondition(index: number) {},
    toggleCreateNewCondition(status: boolean) {
      this.showNewCondition = status
    },
    async initTableList() {
      const res = await describeTables()
      // this.loadingTables = false;
      this.tables = res || []
      this.inited = true
      if (!this.currentTable) {
        this.changeTable(res[0].name || '')
      }
      log('initTableList')
    },
    async addTableBefore(name: string) {
      return addTable(name)
    },
    addTable(name: string) {
      this.tables.push({
        name,
        desc: '',
      })
      this.changeTable(name)
      log(this.tables)
    },
    async delTableBefore(name: string) {
      await asyncAppSocketSend(WS_EVENT.DATABASE_TABLE_DELETE, { name })
    },
    delTableAfter() {},
    async refreshData() {
      this.queryData()
      const res = await describeTables()
      this.tables = res || []
    },
    async getTableInfo(name: string) {
      try {
        const info = await getTableInfo(name)
        this.tableInfo = info
        log('table detail', name, info)
      } catch (error) {
        acMessage.error('Query table detail failed')
      }
    },
    async queryData() {
      this.tableDataLoading = true
      await this.getTableInfo(this.currentTable)
      const queryData: QueryData = this.queryCondition
      try {
        const res = await queryTableData({ ...queryData, page: this.page })
        log('res data ==> ', res)
        // const _data = JSON.parse(dataJson)
        this.tableData = Object.keys(res.data).map((k) => {
          return res.data[k]
        })
        this.total = res.count
      } catch (error) {
        acMessage.error('Query database data list failed')
      }
      this.tableDataLoading = false

      log(this.tableData)
    },
    handleModalCreateVisible(visible: boolean) {
      this.modalCreateVisible = visible
    },
    handleModalCreateIndexVisible(visible: boolean) {
      this.modalCreateIndexVisible = visible
    },
    handleModalAddFieldVisible(visible: boolean) {
      this.modalAddFieldVisible = visible
    },
    handleModalUpdateFieldVisible(visible: boolean) {
      this.modalUpdateFieldVisible = visible
    },
    handleModalDataPreviewVisible(visible: boolean) {
      this.modalDataPreviewVisible = visible
    },
  },
})

type RequiredField<T, K extends keyof T> = Partial<T> & Pick<T, K>
