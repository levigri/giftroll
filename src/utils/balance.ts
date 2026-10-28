// DEPRECATED: заменено серверным API. Файл оставлен для истории, не используется.
/**
 * Пробный баланс пользователя — только звёзды.
 * Значения хранятся в localStorage, чтобы переживать перезагрузку страницы.
 *
 * Когда позже начнём принимать TON, конвертация будет: 1 TON = 100 звёзд.
 */

const BALANCE_KEY = 'starsBalance'
const DEFAULT_BALANCE = 1000

function readValue(): number {
  const raw = localStorage.getItem(BALANCE_KEY)

  // Ключа нет — ставим пробный баланс 1000.
  if (raw === null || raw.trim() === '') {
    localStorage.setItem(BALANCE_KEY, String(DEFAULT_BALANCE))
    return DEFAULT_BALANCE
  }

  const parsed = Number(raw)
  if (Number.isNaN(parsed)) {
    localStorage.setItem(BALANCE_KEY, String(DEFAULT_BALANCE))
    return DEFAULT_BALANCE
  }

  return parsed
}

/** Текущий баланс звёзд (по умолчанию 1000). */
export function getBalance(): number {
  return readValue()
}

/** Прибавляет/вычитает звёзды, сохраняет и возвращает новый баланс. */
export function updateBalance(delta: number): number {
  const next = getBalance() + delta
  localStorage.setItem(BALANCE_KEY, String(next))
  return next
}

/** Сбрасывает баланс на 1000 звёзд. */
export function resetBalance(): void {
  localStorage.setItem(BALANCE_KEY, String(DEFAULT_BALANCE))
}
