<script setup lang="ts">
import { Megaphone } from 'lucide-vue-next'

const message = '市场还在就还有机会，别几把狗叫这那的，好好做！'
</script>

<template>
  <section class="system-announcement" aria-label="系统公告" role="status">
    <div class="system-announcement__label">
      <Megaphone :size="15" aria-hidden="true" />
      <span>系统公告</span>
    </div>
    <div class="system-announcement__viewport">
      <div class="system-announcement__track" aria-hidden="true">
        <span class="system-announcement__message">{{ message }}</span>
        <span class="system-announcement__message" aria-hidden="true">{{ message }}</span>
      </div>
      <span class="system-announcement__sr-only">{{ message }}</span>
    </div>
  </section>
</template>

<style scoped>
.system-announcement {
  display: flex;
  align-items: center;
  gap: 14px;
  min-height: 34px;
  padding: 0 32px;
  overflow: hidden;
  color: var(--el-color-primary);
  background: var(--el-color-primary-light-9);
  border-bottom: 1px solid var(--el-color-primary-light-7);
}

.system-announcement__label {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  flex: 0 0 auto;
  font-size: 11px;
  font-weight: 650;
  white-space: nowrap;
}

.system-announcement__viewport {
  min-width: 0;
  overflow: hidden;
  flex: 1;
}

.system-announcement__track {
  display: flex;
  width: max-content;
  animation: system-announcement-scroll 20s linear infinite;
}

.system-announcement__message {
  display: block;
  padding-right: 72px;
  color: var(--el-text-color-regular);
  font-size: 12px;
  line-height: 1.5;
  white-space: nowrap;
}

.system-announcement__sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

@keyframes system-announcement-scroll {
  from { transform: translateX(0); }
  to { transform: translateX(-50%); }
}

@media (max-width: 760px) {
  .system-announcement { gap: 9px; min-height: 32px; padding: 0 16px; }
  .system-announcement__label span { display: none; }
  .system-announcement__message { font-size: 11px; padding-right: 48px; }
}

@media (prefers-reduced-motion: reduce) {
  .system-announcement__track {
    width: 100%;
    animation: none;
  }

  .system-announcement__message { display: none; }
  .system-announcement__message:first-child {
    display: block;
    width: 100%;
    padding-right: 0;
    overflow: hidden;
    text-align: center;
    text-overflow: ellipsis;
  }
}
</style>
