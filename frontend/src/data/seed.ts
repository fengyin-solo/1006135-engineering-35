// 样例数据唯一真源在 seed.json：准备/回填与构建期校验都读这一份，
// 准备入口和恢复入口也共用它，避免两处各写一份对不上。
// ?url 让 Vite 额外把这份清单原样发进发布制品（dist/assets/seed-*.json），
// 容器里可以直接核对发布件里的样例条数，不再出现“制品里没有样例数据”。
import seedData from './seed.json'
import seedAssetUrl from './seed.json?url'
import type { EntryRow } from './types'

export const SEED_ROWS = seedData as unknown as Record<string, EntryRow[]>

export const SEED_ASSET_URL = seedAssetUrl
