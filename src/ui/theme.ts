import { computed, ref } from 'vue'

// index.html has already applied the persisted preference before first paint.
export const darkMode = ref(document.documentElement.classList.contains('dark'))
export const themeAction = computed(() => darkMode.value ? '切换到日间模式' : '切换到暗黑模式')
export function toggleTheme() {
  darkMode.value = !darkMode.value
  document.documentElement.classList.toggle('dark', darkMode.value)
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', darkMode.value ? '#17151e' : '#7860d7')
  try { localStorage.setItem('tradelog.theme', darkMode.value ? 'dark' : 'light') }
  catch { /* Switching remains available for this visit without persistence. */ }
}
