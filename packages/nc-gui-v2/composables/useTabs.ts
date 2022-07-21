import { useState } from '#app'

export interface TabItem {
  type: 'table' | 'view' | 'auth'
  title: string
  id?: string
}

export default () => {
  const tabs = useState<TabItem[]>('tabs', () => [])
  const activeTab = useState<number>('activeTab', () => 0)

  const addTab = (tabMeta: TabItem) => {
    const tabIndex = tabs.value.findIndex((tab) => tab.id === tabMeta.id)
    // if tab already found make it active
    if (tabIndex > -1) {
      activeTab.value = tabIndex
    }
    // if tab not found add it
    else {
      tabs.value = [...(tabs.value || []), tabMeta]
      activeTab.value = tabs.value.length - 1
    }
  }
  const clearTabs = () => {
    tabs.value = []
  }
  const closeTab = (index: number) => {
    tabs.value.splice(index, 1)
  }

  return { tabs, addTab, activeTab, clearTabs, closeTab }
}
