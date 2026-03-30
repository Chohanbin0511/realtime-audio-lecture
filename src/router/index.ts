import { createRouter, createWebHistory } from 'vue-router'
import BroadcastPageNew from '@/pages/BroadcastPageNew.vue'
import ListenPageNew from '@/pages/ListenPageNew.vue'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', redirect: '/broadcast' },
    { path: '/broadcast', component: BroadcastPageNew, meta: { title: '방송하기' } },
    { path: '/listen', component: ListenPageNew, meta: { title: '실시간 강의(학생)' } },
  ],
})

export default router
