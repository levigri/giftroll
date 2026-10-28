import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  // envDir — '.' : npm-скрипты запускаются из корня проекта, Vite резолвит
  // путь сам (process здесь намеренно не используется — нет @types/node).
  const env = loadEnv(mode, '.', '')

  // Прокси нужен ТОЛЬКО локальной разработке: Vite dev-сервер подставляет
  // запросы /api на локальный бэкенд. В продакшне (Vercel) фронтенд ходит
  // в API по абсолютному адресу из VITE_API_URL (см. src/api/client.ts),
  // поэтому при заданном VITE_API_URL прокси отключается совсем.
  const apiBase = (env.VITE_API_URL || '').trim()
  const proxy =
    apiBase !== ''
      ? undefined
      : {
          '/api': {
            target: env.VITE_DEV_API_PROXY || 'http://localhost:3000',
            changeOrigin: true,
          },
        }

  return {
    plugins: [react()],
    server: {
      host: true,
      port: 5173,
      allowedHosts: true,
      ...(proxy ? { proxy } : {}),
    },
  }
})
