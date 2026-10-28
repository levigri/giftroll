import React from 'react'
import ReactDOM from 'react-dom/client'
import { TonConnectUIProvider } from '@tonconnect/ui-react'
import App from './App.tsx'
import { captureStartParamRef, initTelegram } from './telegram'
import './index.css'

// Инициализация Telegram Mini Apps SDK (тема, haptics, размеры).
initTelegram()

// Реферальный код из ссылки t.me/<bot>?startapp=ref_<id> — до первых запросов к API.
captureStartParamRef()

// Манифест TonConnect: обязан быть абсолютным HTTPS-URL, доступным с телефона.
// localhost кошельки не видят, поэтому при локальной разработке указываем
// публичный туннель (VITE_TONCONNECT_MANIFEST_URL в .env), иначе — origin страницы.
const tonConnectManifestUrl =
  import.meta.env.VITE_TONCONNECT_MANIFEST_URL || `${window.location.origin}/tonconnect-manifest.json`

console.log('[TON] manifestUrl:', tonConnectManifestUrl)

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <TonConnectUIProvider manifestUrl={tonConnectManifestUrl}>
      <App />
    </TonConnectUIProvider>
  </React.StrictMode>,
)
