// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { STORAGE_PREFIX } from '@/data/local-store'
import type { EntryRow } from '@/data/types'

// 每个用例从空 storage、空模块缓存开始，互不串数据。
beforeEach(() => {
  window.localStorage.clear()
  vi.resetModules()
})

async function freshModules() {
  // resetModules 后重新拿模块，确保模块内的 cache 被清空。
  const store = await import('@/data/local-store')
  const service = await import('@/api/local-service')
  return { store, service }
}

describe('准备入口：幂等、续跑', () => {
  it('重复执行不会翻倍，第二次全部跳过', async () => {
    const { store, service } = await freshModules()
    store.saveRows('building', [])

    const first = service.prepareBuilding()
    expect(first.ok).toBe(true)
    expect(store.listRows('building')).toHaveLength(3)

    const second = service.prepareBuilding()
    expect(second.ok).toBe(true)
    expect(second.prepared).toBe(0)
    expect(second.skipped).toBe(3)
    expect(store.listRows('building')).toHaveLength(3)
  })

  it('同一条重复递两次只记一次（同对象编号合并）', async () => {
    const { store, service } = await freshModules()
    const dup: EntryRow = {
      id: 9,
      status: '待布点',
      pending: true,
      abnormal: false,
      createdAt: '2026-09-10T08:00:00.000Z',
      对象编号: 'BUIL-9009',
      建筑物名称: '重复楼',
      // 缺距隧道距离等字段，第二条会把它补上
    }
    store.saveRows('building', [
      dup,
      {
        ...dup,
        id: 10,
        createdAt: '2026-09-11T08:00:00.000Z',
        距隧道距离: '6.4',
        结构类型: '框架结构',
      },
    ])

    const result = service.prepareBuilding()
    expect(result.ok).toBe(true)
    const rows = store.listRows('building')
    expect(rows.filter((r) => r['对象编号'] === 'BUIL-9009')).toHaveLength(1)
    expect(rows.find((r) => r['对象编号'] === 'BUIL-9009')?.['距隧道距离']).toBe('6.4')
  })

  it('跑到一半写库失败：水位不前移，重跑能续上且不翻倍', async () => {
    const { store, service } = await freshModules()
    store.saveRows('building', [])

    const realSetItem = window.localStorage.setItem.bind(window.localStorage)
    let call = 0
    // 放第 2 条样例（第一次主数据写入）失败，模拟跑到一半挂掉。
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (key, value) {
      call += 1
      if (key.startsWith(STORAGE_PREFIX) && call >= 2) {
        throw new Error('QuotaExceededError')
      }
      return realSetItem(key, value)
    })

    expect(() => service.prepareBuilding()).toThrow()
    spy.mockRestore()

    // 第一条写入后即失败：水位应停在 0（写失败不推进），库里只有 1 条。
    const progress = (await import('@/data/local-store')).getPrepareProgress('building')
    expect(progress).toBe(0)
    expect(store.listRows('building')).toHaveLength(1)

    // 重跑：已有那条被跳过，补齐剩余两条，最终 3 条。
    const resume = service.prepareBuilding()
    expect(resume.ok).toBe(true)
    expect(store.listRows('building')).toHaveLength(3)
  })
})

describe('存量记录：回填、兼容读法、越限拦截', () => {
  it('存量缺字段照对应样例补上，整块不丢弃，并按创建时间排队回填', async () => {
    const { store, service } = await freshModules()
    store.saveRows('building', [
      {
        id: '7', // 字符串 id：本地/容器类型不一致的存量写法
        status: '待布点',
        pending: true,
        abnormal: false,
        createdAt: '2026-09-05T08:00:00.000Z',
        对象编号: 'BUIL-0007',
        // 建筑物名称、距隧道距离等全部缺失
      },
    ])

    const result = service.prepareBuilding()
    expect(result.ok).toBe(true)
    expect(result.backfilled).toBeGreaterThan(0)
    const rows = store.listRows('building')
    expect(rows).toHaveLength(4) // 存量 1 条 + 样例 3 条，没丢
    const legacy = rows.find((r) => Number(r.id) === 7)
    expect(legacy).toBeDefined()
    expect(typeof legacy!.id).toBe('number') // id 已归一化为数字
    expect(legacy!['建筑物名称']).not.toBe('')
    expect(legacy!['距隧道距离']).not.toBe('')
  })

  it('旧字段名（距隧道净距）兼容读取，距隧道距离那栏不再为空', async () => {
    const { store } = await freshModules()
    window.localStorage.setItem(
      store.storageKey(),
      JSON.stringify({
        building: [
          {
            id: 1,
            status: '待布点',
            pending: true,
            abnormal: false,
            对象编号: 'BUIL-0001',
            距隧道净距: '9.3', // 存量旧叫法
          },
        ],
      }),
    )
    // 清模块缓存，强制重新读 storage
    const rows = (await import('@/data/local-store')).listRows('building')
    expect(rows[0]['距隧道距离']).toBe('9.3')
  })

  it('越限记录在准备阶段就报出来，且不写库', async () => {
    const { store, service } = await freshModules()
    const before: EntryRow = {
      id: 5,
      status: '监测中',
      pending: true,
      abnormal: false,
      createdAt: '2026-09-05T08:00:00.000Z',
      对象编号: 'BUIL-0005',
      建筑物名称: '越限楼',
      结构类型: '框架',
      距隧道距离: '99', // 超过上限 50
      允许沉降: '30',
      实测沉降: '10',
      监测频次: '1次/日',
      监测状态: '监测中',
    }
    store.saveRows('building', [before])

    const result = service.prepareBuilding()
    expect(result.ok).toBe(false)
    expect(result.violations.some((v) => v.field === '距隧道距离')).toBe(true)
    // 中止：库里仍是原状，没有灌进任何样例
    expect(store.listRows('building')).toHaveLength(1)
  })
})

describe('建筑监测 ↔ 地表沉降：同源', () => {
  it('准备结果反映到地表沉降清单，两处条数同步', async () => {
    const { store, service } = await freshModules()
    store.saveRows('building', [])
    store.saveRows('settlement', [])

    service.prepareBuilding()

    expect(service.getRows('building')).toHaveLength(3)
    expect(service.getRows('settlement')).toHaveLength(3)
    expect(service.buildingSettlementSync()).toMatchObject({ linked: 3, orphan: 0 })

    const building = service.getRows('building')
    const settlement = service.getRows('settlement')
    const buildingKeys = building.map((r) => r['对象编号']).sort()
    const linkedKeys = settlement.map((r) => r['关联对象编号']).sort()
    expect(linkedKeys).toEqual(buildingKeys)
  })

  it('存量孤立沉降测点保留不丢，但联测条数仍等于建筑条数', async () => {
    const { store, service } = await freshModules()
    store.saveRows('building', [])
    store.saveRows('settlement', [
      {
        id: 88,
        status: '正常',
        pending: true,
        abnormal: false,
        测点编号: 'SETT-LEGACY-1',
        测点位置: '早年人工测点',
      },
    ])

    service.prepareBuilding()
    expect(service.buildingSettlementSync()).toMatchObject({ linked: 3, orphan: 1 })
    expect(service.getRows('settlement')).toHaveLength(4)
  })

  it('恢复初始状态两处一起复原，且与准备读同一套样例', async () => {
    const { store, service } = await freshModules()
    store.saveRows('building', [])
    store.saveRows('settlement', [])

    service.prepareBuilding()
    service.runAction('building', 1, '布设测点') // 改动状态
    expect(service.getRows('building')[0].status).toBe('监测中')

    service.resetBuilding()
    const building = service.getRows('building')
    expect(building).toHaveLength(3)
    expect(building[0].status).toBe('待布点')
    expect(service.getRows('settlement')).toHaveLength(3)
  })
})

describe('写库失败就地撤销', () => {
  it('状态流转写库失败时内存回滚，不产生“界面改了库里没改”', async () => {
    const { store, service } = await freshModules()
    service.prepareBuilding()

    const realSetItem = window.localStorage.setItem.bind(window.localStorage)
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (key, value) {
      if (key.startsWith(STORAGE_PREFIX + 'entries')) {
        throw new Error('QuotaExceededError')
      }
      return realSetItem(key, value)
    })

    const result = service.runAction('building', 1, '布设测点')
    spy.mockRestore()

    expect(result.ok).toBe(false)
    // 内存已撤销：仍是原状态
    expect(service.getRows('building').find((r) => Number(r.id) === 1)?.status).toBe('待布点')
  })
})

describe('卡片数字同源', () => {
  it('建筑监测与地表沉降的统计读同一实现、同一份清单', async () => {
    const { service } = await freshModules()
    service.resetBuilding()
    const buildingCards = service.moduleCards('building')
    const settlementCards = service.moduleCards('settlement')
    expect(buildingCards.map((c) => c.label)).toEqual(['监测中对象', '报警对象', '待布点对象'])
    expect(settlementCards.map((c) => c.label)).toEqual(['正常测点', '预警测点', '最大累计沉降'])
    // 样例里 BUIL-0002 监测中、BUIL-0003 已报警、BUIL-0001 待布点
    expect(buildingCards.find((c) => c.label === '监测中对象')?.value).toBe(1)
    expect(buildingCards.find((c) => c.label === '报警对象')?.value).toBe(1)
    // 沉降侧第三张卡与建筑实测沉降同源：最大值 18.6
    expect(settlementCards.find((c) => c.label === '最大累计沉降')?.value).toBe(18.6)
  })
})
