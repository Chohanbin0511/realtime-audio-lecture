<script setup lang="ts">
import { ref } from 'vue'
import {
  BookOpen,
  ChevronRight,
  Clock,
  MapPin,
  Mic,
} from 'lucide-vue-next'
import Button from '@/components/ui/Button.vue'
import Card from '@/components/ui/Card.vue'
import CardContent from '@/components/ui/CardContent.vue'
import CardHeader from '@/components/ui/CardHeader.vue'
import Badge from '@/components/ui/Badge.vue'
import Progress from '@/components/ui/Progress.vue'
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from '@/components/ui/dialog'
import BroadcastSessionPanel from '@/components/BroadcastSessionPanel.vue'

const sessionOpen = ref(false)

/** 데모: 실제로는 로그인/프로필 API */
const professorName = ref('김태진')

const upcoming = ref({
  title: '실험 설계와 모델 평가',
  time: '오후 4:00',
  place: '과학관 304호',
})

const myLectures = ref([
  { title: '실험 설계와 모델 평가', time: '오후 4:00', place: '과학관 304', active: true },
  { title: '딥러닝 기초', time: '화 2:00', place: '공대 201', active: false },
  { title: '데이터 시각화', time: '목 10:00', place: '도서관 세미나실', active: false },
])

const recentAnalysis = ref([
  {
    title: '지난주 실습',
    date: '3/20',
    participation: 83,
    badges: ['AI 요약완료', '퀴즈생성완료'] as const,
  },
  {
    title: '중간 점검',
    date: '3/18',
    participation: 71,
    badges: ['AI 요약완료'] as const,
  },
  {
    title: '중간 점검',
    date: '3/18',
    participation: 71,
    badges: ['AI 요약완료'] as const,
  },
  {
    title: '중간 점검',
    date: '3/18',
    participation: 71,
    badges: ['AI 요약완료'] as const,
  },
])

const aiInsight = ref(
  '최근 수업에서 질문 응답 비율이 전주 대비 12% 상승했습니다. 실습 구간에서 학습자 체류 시간이 길어졌으니, 다음 주에는 퀴즈 난이도를 한 단계 조정해 보는 것을 권장합니다.',
)

function openSession() {
  sessionOpen.value = true
}

function closeSession() {
  sessionOpen.value = false
}
</script>

<template>
  <div class="broadcast-dash">
    <div class="dash-inner">
      <!-- 인사 -->
      <p class="dash-greet">
        안녕하세요, {{ professorName }} 교수님 <span aria-hidden="true">👋</span>
      </p>

      <!-- 다가오는 수업 + 나의 수업 목록: 피그마처럼 상단 블루·하단 리스트 하나의 카드 스택 -->
      <div class="dash-hero-list-stack">
        <section
          class="hero-card hero-card--stack-top"
          aria-labelledby="upcoming-title"
        >
          <div class="hero-watermark" aria-hidden="true">PNU</div>
          <div class="hero-top">
            <span class="hero-label">Upcoming lecture</span>
          </div>
          <h2 id="upcoming-title" class="hero-title">
            {{ upcoming.title }}
          </h2>
          <div class="hero-meta">
            <span class="hero-meta-item">
              <Clock class="hero-ic" stroke-width="2" />
              {{ upcoming.time }}
            </span>
            <span class="hero-meta-item">
              <MapPin class="hero-ic" stroke-width="2" />
              {{ upcoming.place }}
            </span>
          </div>
          <div class="hero-actions">
            <Button
              type="button"
              variant="secondary"
              class="hero-cta"
              @click="openSession"
            >
              <Mic class="hero-cta-ic" stroke-width="2" />
              수업시작 및 녹음하기
            </Button>
          </div>
        </section>

        <div class="dash-stack-list-wrap">
          <div class="dash-section-head dash-stack-list-head">
            <h3 id="list-heading" class="dash-h3">나의 수업 목록</h3>
            <button type="button" class="dash-link">
              전체
              <ChevronRight class="h-4 w-4" />
            </button>
          </div>
          <Card class="dash-card dash-card-surface dash-stack-list-card">
            <CardContent class="list-card-content space-y-0 p-0">
              <button
                v-for="(lec, i) in myLectures"
                :key="i"
                type="button"
                class="lecture-row"
                :class="{ 'lecture-row--active': lec.active }"
              >
                <div class="lecture-icon-wrap">
                  <BookOpen class="h-5 w-5 text-slate-500" stroke-width="1.8" />
                </div>
                <div class="lecture-main">
                  <p class="lecture-title">{{ lec.title }}</p>
                  <p class="lecture-sub">
                    <Clock class="inline h-3.5 w-3.5 opacity-70" />
                    {{ lec.time }}
                    <span class="mx-1.5 opacity-40">·</span>
                    {{ lec.place }}
                  </p>
                </div>
                <ChevronRight class="h-5 w-5 shrink-0 text-slate-400" />
              </button>
            </CardContent>
          </Card>
        </div>
      </div>

      <!-- 최근 수업 분석 -->
      <section class="dash-section" aria-labelledby="analysis-heading">
        <div class="dash-section-head">
          <h3 id="analysis-heading" class="dash-h3">최근 수업 분석</h3>
        </div>
        <div class="dash-section-body">
          <div class="analysis-cards">
          <Card
            v-for="(item, i) in recentAnalysis"
            :key="i"
            class="analysis-card dash-card dash-card-surface"
          >
            <CardHeader class="analysis-card-h p-4 pb-2">
              <p class="analysis-title">{{ item.title }}</p>
              <p class="analysis-date">{{ item.date }}</p>
            </CardHeader>
            <CardContent class="space-y-3 p-4 pt-0">
              <div class="flex flex-wrap gap-1.5">
                <Badge
                  v-for="(b, j) in item.badges"
                  :key="j"
                  variant="success"
                  class="text-[10px]"
                >
                  {{ b }}
                </Badge>
              </div>
              <div>
                <div class="mb-1.5 flex justify-between text-[11px] text-slate-500">
                  <span>학생 참여율</span>
                  <span class="font-medium text-slate-700">{{ item.participation }}%</span>
                </div>
                <Progress :model-value="item.participation" />
              </div>
            </CardContent>
          </Card>
          </div>
        </div>
      </section>

      <!-- AI 학습 분석 알림 -->
      <section class="dash-section" aria-labelledby="ai-heading">
        <div class="dash-section-head">
          <h3 id="ai-heading" class="dash-h3">AI 학습 분석 알림</h3>
        </div>
        <div class="dash-section-body">
          <Card class="dash-card dash-card-surface">
          <CardContent class="p-4">
            <div class="ai-insight-inner">
              <p class="ai-text">
                {{ aiInsight }}
              </p>
            </div>
          </CardContent>
          </Card>
        </div>
      </section>
    </div>

    <Dialog v-model:open="sessionOpen">
      <DialogContent>
        <DialogTitle class="sr-only">실시간 오디오 방송</DialogTitle>
        <BroadcastSessionPanel @close="closeSession" />
      </DialogContent>
    </Dialog>
  </div>
</template>

<style scoped lang="scss" src="@/styles/pages/broadcast.scss"></style>
