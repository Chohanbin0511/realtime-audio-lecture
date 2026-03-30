<template>
  <div class="app">
    <!-- 심플한 헤더 -->
    <header class="header">
      <div class="header-content">
        <div class="logo">
          <div class="logo-icon" aria-hidden="true">AW</div>
          <div class="logo-text-wrap">
            <span class="logo-text">Audio Wowza</span>
            <!-- 데스크톱: 부제 한 줄 / 모바일: 짧은 부제만 (한 줄 유지) -->
            <span class="header-tagline header-tagline--full">실시간 오디오 방송 & 청취</span>
            <span class="header-tagline header-tagline--short">방송 · 청취</span>
          </div>
        </div>
      </div>
    </header>

    <!-- 메인 컨텐츠 -->
    <main class="main">
      <router-view />
    </main>

    <!-- 하단 탭 네비게이션 -->
    <footer class="bottom-nav">
      <router-link to="/broadcast" class="nav-tab" active-class="active">
        <div class="nav-icon">🎙</div>
        <span class="nav-label">방송하기</span>
      </router-link>
      <router-link to="/listen" class="nav-tab" active-class="active">
        <div class="nav-icon">🎓</div>
        <span class="nav-label nav-label--stack">
          <span class="nav-label-line">실시간 강의</span>
          <span class="nav-label-line nav-label-line--sub">(학생)</span>
        </span>
      </router-link>
    </footer>
  </div>
</template>

<style scoped lang="scss" src="@/styles/layout/app.scss"></style>
