import {
  hapticFeedback,
  init,
  initData,
  isTMA,
  miniApp,
  themeParams,
  type User,
} from '@telegram-apps/sdk'

let dispose: VoidFunction | undefined
let unbindThemeCssVars: VoidFunction | undefined
let inTelegram = false

/**
 * Инициализация @telegram-apps/sdk.
 * Возвращает true, если приложение запущено внутри Telegram.
 * В обычном браузере (npm run dev) ничего не ломается — просто вернётся false.
 */
export function initTelegram(): boolean {
  if (dispose) {
    return inTelegram
  }
  if (!isTMA()) {
    return false
  }

  // Среда определяется по isTMA(): launch params Telegram видны.
  // Сбой init() (например, postEvent iframe_ready в обычном браузере)
  // не должен скрывать шапку/пользователя — инициализация best-effort.
  inTelegram = true

  try {
    dispose = init()
  } catch (error) {
    console.warn('[GiftRoll] Telegram SDK init failed:', error)
  }

  try {
    // Восстанавливаем initData (initDataUnsafe.user и т.д.) из launch params.
    initData.restore()

    // Монтируем компоненты и вешаем CSS-переменные --tg-theme-*
    // (bg-color, text-color, button-color и т.д.) на <html>.
    themeParams.mountSync.ifAvailable()
    const bound = themeParams.bindCssVars.ifAvailable()
    if (bound[0]) {
      unbindThemeCssVars = bound[1]
    }

    miniApp.mountSync.ifAvailable()
    miniApp.ready.ifAvailable()
  } catch (error) {
    console.warn('[GiftRoll] Telegram components mount failed:', error)
  }

  return true
}

export function disposeTelegram(): void {
  unbindThemeCssVars?.()
  unbindThemeCssVars = undefined
  dispose?.()
  dispose = undefined
  inTelegram = false
}

/** Приложение запущено внутри Telegram (а не в обычном браузере). */
export function isTelegramEnv(): boolean {
  return inTelegram
}

/**
 * Пользователь из initDataUnsafe.user.
 * Вне Telegram (или при отсутствии данных) — undefined.
 */
export function getTelegramUser(): User | undefined {
  try {
    return initData.user()
  } catch {
    return undefined
  }
}

/**
 * Возвращает сырую строку initData из Telegram WebApp.
 * Вне Telegram возвращает пустую строку.
 */
export function getInitData(): string {
  try {
    const raw = initData.raw()
    if (raw) {
      return raw
    }
  } catch {
    // ignore
  }

  return (
    (window as unknown as { Telegram?: { WebApp?: { initData?: string } } })
      .Telegram?.WebApp?.initData ?? ''
  )
}

/** Ключ localStorage с реферальным кодом из start_param (ref_<telegramId>). */
export const REF_CODE_STORAGE_KEY = 'ref_code'

/**
 * start_param из ссылки t.me/<bot>?startapp=ref_<id>.
 *
 * Работает и в Telegram, и в обычном браузере, поэтому проверяем
 * два источника по порядку:
 * 1) Telegram: initData.startParam() (SDK v3), затем
 *    window.Telegram.WebApp.initDataUnsafe.start_param, затем launch params URL;
 * 2) браузер: ?startapp=ref_<id> в query и в hash.
 */
export function getStartParam(): string {
  try {
    const fromSdk = initData.startParam()
    if (fromSdk) {
      return fromSdk
    }
  } catch {
    // Компонент не смонтирован — идём дальше.
  }

  try {
    const fromWebApp = (
      window as unknown as {
        Telegram?: { WebApp?: { initDataUnsafe?: { start_param?: string } } }
      }
    )?.Telegram?.WebApp?.initDataUnsafe?.start_param
    if (fromWebApp) {
      return fromWebApp
    }
  } catch {
    // ignore
  }

  // URL: обычный браузер (?startapp=ref_123) и launch params Telegram
  // (#tgWebAppStartParam=ref_123) — на случай, если SDK ничего не отдал.
  try {
    const search = new URLSearchParams(window.location.search)
    const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''))

    return (
      search.get('startapp') ||
      search.get('start_param') ||
      hash.get('tgWebAppStartParam') ||
      hash.get('startapp') ||
      ''
    )
  } catch {
    return ''
  }
}

/**
 * Запоминает start_param вида ref_<id> из ссылки t.me/<bot>?startapp=ref_<id>.
 * Значение уйдёт заголовком X-Ref-Code во всех запросах к API.
 */
export function captureStartParamRef(): void {
  try {
    const startParam = getStartParam()
    if (startParam.startsWith('ref_')) {
      localStorage.setItem(REF_CODE_STORAGE_KEY, startParam)
    }
  } catch {
    // localStorage может быть недоступен (приватный режим) — не критично.
  }
}

/** Реферальный код, сохранённый из start_param ('' если его нет). */
export function getStoredRefCode(): string {
  try {
    return localStorage.getItem(REF_CODE_STORAGE_KEY) ?? ''
  } catch {
    return ''
  }
}

/** Мягкая виброотдача, если клиент её поддерживает. */
export function tapFeedback(style: 'light' | 'medium' | 'rigid' = 'medium'): void {
  try {
    hapticFeedback.impactOccurred.ifAvailable(style)
  } catch {
    // Вибрация не критична: не должна ломать игровой цикл.
  }
}

export function successFeedback(): void {
  try {
    hapticFeedback.notificationOccurred.ifAvailable('success')
  } catch {
    // ignore
  }
}

export function errorFeedback(): void {
  try {
    hapticFeedback.notificationOccurred.ifAvailable('error')
  } catch {
    // ignore
  }
}
