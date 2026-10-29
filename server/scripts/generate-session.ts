import 'dotenv/config'
import { TelegramClient } from 'telegram'
import { StringSession } from 'telegram/sessions/index.js'
import input from 'input'

const apiId = Number(process.env.TELEGRAM_API_ID)
const apiHash = process.env.TELEGRAM_API_HASH

if (!Number.isInteger(apiId) || apiId <= 0 || !apiHash) {
  throw new Error('Set TELEGRAM_API_ID and TELEGRAM_API_HASH in server/.env first')
}

const client = new TelegramClient(new StringSession(''), apiId, apiHash, {
  connectionRetries: 5,
})

try {
  console.log('Подключение к Telegram…')
  await client.start({
    phoneNumber: async () => input.text('Введите номер телефона (+7999…): '),
    password: async () => input.password('Введите пароль 2FA (если включён): '),
    phoneCode: async () => input.text('Введите код из Telegram: '),
    onError: (error) => console.error('[Session] Ошибка авторизации:', error.message),
  })

  console.log('\n=== ВАША СЕССИЯ TELEGRAM ===')
  console.log(client.session.save())
  console.log('============================')
  console.log('Сохраните строку как TELEGRAM_SESSION в server/.env и в защищённые env Render.')
  console.log('Не отправляйте её в чат, GitHub или логи сборки.')
} finally {
  await client.disconnect()
}
