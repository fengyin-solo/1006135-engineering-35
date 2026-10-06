// @vitest-environment jsdom
// 渲染级冒烟：把 App + 路由真正挂起来，防止“构建过、页面空白”。
import { describe, expect, it } from 'vitest'
import { createApp } from 'vue'
import { createPinia } from 'pinia'

import App from '@/App.vue'

describe('应用渲染冒烟（防空白页）', () => {
  it('挂载后渲染出建筑监测入口与页面内容', async () => {
    document.body.innerHTML = '<div id="app"></div>'
    const router = (await import('@/router')).default
    const app = createApp(App)
    app.use(createPinia())
    app.use(router)
    await router.isReady()
    app.mount('#app')

    expect(document.querySelector('.app-title')?.textContent).toContain('盾构隧道')
    expect(document.querySelectorAll('.nav-item').length).toBeGreaterThan(10)

    await router.push('/building')
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(document.querySelector('h2')?.textContent).toContain('建筑监测')
    // 样例在挂载时已由存储层兜底播种：表格有行，不是空白。
    expect(document.querySelectorAll('.data-table tbody tr').length).toBeGreaterThan(0)

    await router.push('/settlement')
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(document.querySelector('h2')?.textContent).toContain('地表沉降')
    expect(document.querySelectorAll('.data-table tbody tr').length).toBeGreaterThan(0)
  })
})
