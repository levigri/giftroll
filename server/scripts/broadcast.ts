import { Bot } from 'grammy'
import { env } from '../src/config/env.js'
import { prisma } from '../src/db/prisma.js'

const text =
  '🎁 Заходи в GiftRoll!\n\nОткрывай кейсы, собирай NFT и звезды.\nЗапускай приложение и играй!'

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function main(): Promise<void> {
  const bot = new Bot(env.BOT_TOKEN)

  try {
    const users = await prisma.user.findMany({
      select: { id: true, firstName: true },
    })

    console.log(`Найдено пользователей: ${users.length}`)

    for (const user of users) {
      try {
        await bot.api.sendMessage(user.id.toString(), text, {
          reply_markup: {
            inline_keyboard: [[
              {
                text: '🎁 Забрать кейс',
                web_app: { url: 'https://giftroll-six.vercel.app/?v=2' },
              },
            ]],
          },
        })
        console.log(`✅ Отправлено: ${user.firstName} (${user.id})`)
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error)
        console.error(`❌ Ошибка: ${user.id} - ${message}`)
      }

      await delay(50)
    }

    console.log('✅ Рассылка завершена!')
  } finally {
    await prisma.$disconnect()
  }
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error)
  console.error(`❌ Ошибка рассылки: ${message}`)
  process.exitCode = 1
})
