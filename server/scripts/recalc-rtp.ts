import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import type { Prize } from '../src/data/cases.js'
import { allCases } from '../src/data/cases.js'

const targetRtpByCaseId: Readonly<Record<string, number>> = {
  'case-start': 89,
  'case-amateur': 90,
  'case-pro': 94,
  'case-hunter': 93,
  'case-legend': 93,
}

const CHANCE_UNITS_PER_PERCENT = 100
const TOTAL_CHANCE_UNITS = 100 * CHANCE_UNITS_PER_PERCENT
const MAJOR_TRANSFER_UNITS = 10 // 0.1 percentage point
const sourcePath = fileURLToPath(new URL('../src/data/cases.ts', import.meta.url))

interface PrizeChance {
  prize: Prize
  units: number
}

function score(items: readonly PrizeChance[]): number {
  return items.reduce((total, item) => total + item.prize.price * item.units, 0)
}

function rtpPercent(casePrice: number, weightedScore: number): number {
  return (weightedScore / (TOTAL_CHANCE_UNITS * casePrice)) * 100
}

function formatChance(units: number): string {
  return (units / CHANCE_UNITS_PER_PERCENT).toFixed(2)
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function optimizeCase(caseId: string, casePrice: number, targetRtp: number, prizes: Prize[]): {
  items: PrizeChance[]
  oldRtp: number
  newRtp: number
} {
  const items = prizes.map((prize): PrizeChance => ({
    prize,
    units: Math.round(prize.chance * CHANCE_UNITS_PER_PERCENT),
  }))
  const initialTotal = items.reduce((total, item) => total + item.units, 0)
  if (initialTotal !== TOTAL_CHANCE_UNITS) {
    throw new Error(`${caseId}: исходная сумма шансов ${initialTotal / 100}%, ожидалось 100%`)
  }

  const oldScore = score(items)
  const targetScore = Math.round((casePrice * targetRtp * TOTAL_CHANCE_UNITS) / 100)

  // Сначала переносим шанс шагами по 0.1% от самого дешёвого предмета к самому дорогому.
  while (score(items) < targetScore) {
    const donor = [...items]
      .filter((item) => item.units >= MAJOR_TRANSFER_UNITS)
      .sort((a, b) => a.prize.price - b.prize.price)[0]
    const receiver = [...items].sort((a, b) => b.prize.price - a.prize.price)[0]
    if (!donor || !receiver || donor === receiver) break

    const nextScore = score(items) + (receiver.prize.price - donor.prize.price) * MAJOR_TRANSFER_UNITS
    if (nextScore > targetScore) break
    donor.units -= MAJOR_TRANSFER_UNITS
    receiver.units += MAJOR_TRANSFER_UNITS
  }

  // Доводим результат сотыми долями процента, не перенося шанс с дешёвого
  // предмета на дорогой, если такой шаг превысит целевой EV.
  while (score(items) < targetScore) {
    const currentScore = score(items)
    const remaining = targetScore - currentScore
    let bestMove: { donor: PrizeChance; receiver: PrizeChance; delta: number } | null = null

    for (const donor of items) {
      if (donor.units < 1) continue
      for (const receiver of items) {
        if (receiver.prize.price <= donor.prize.price) continue
        const delta = receiver.prize.price - donor.prize.price
        if (delta <= remaining && (!bestMove || delta > bestMove.delta)) {
          bestMove = { donor, receiver, delta }
        }
      }
    }

    if (!bestMove) break
    bestMove.donor.units -= 1
    bestMove.receiver.units += 1
  }

  const totalUnits = items.reduce((total, item) => total + item.units, 0)
  if (totalUnits !== TOTAL_CHANCE_UNITS) {
    throw new Error(`${caseId}: после оптимизации сумма шансов ${totalUnits / 100}%, ожидалось 100%`)
  }

  const newScore = score(items)
  const newRtp = rtpPercent(casePrice, newScore)
  if (Math.abs(newRtp - targetRtp) > 0.05 + Number.EPSILON) {
    throw new Error(`${caseId}: RTP ${newRtp.toFixed(4)}% не попал в допуск ±0.05% от ${targetRtp}%`)
  }

  return { items, oldRtp: rtpPercent(casePrice, oldScore), newRtp }
}

function updateChanceInSource(source: string, caseId: string, prizeId: string, chance: string): string {
  const caseMarker = `id: '${caseId}'`
  const caseStart = source.indexOf(caseMarker)
  const prizesStart = source.indexOf('prizes: [', caseStart)
  const prizesEnd = source.indexOf('\n    ],', prizesStart)
  if (caseStart < 0 || prizesStart < 0 || prizesEnd < 0) {
    throw new Error(`Не удалось найти пул призов кейса ${caseId} в cases.ts`)
  }

  const block = source.slice(prizesStart, prizesEnd)
  const pattern = new RegExp(`(id:\\s*'${escapeRegExp(prizeId)}'[^\\n]*?chance:\\s*)[0-9]+(?:\\.[0-9]+)?`)
  const updatedBlock = block.replace(pattern, `$1${chance}`)
  if (updatedBlock === block) {
    throw new Error(`Не удалось найти приз ${prizeId} в кейсе ${caseId}`)
  }
  return source.slice(0, prizesStart) + updatedBlock + source.slice(prizesEnd)
}

let updatedSource = await readFile(sourcePath, 'utf8')
const summaries: { id: string; target: number; oldRtp: number; newRtp: number }[] = []

for (const [caseId, targetRtp] of Object.entries(targetRtpByCaseId)) {
  const caseItem = allCases.find((item) => item.id === caseId)
  if (!caseItem) throw new Error(`Кейс ${caseId} отсутствует в allCases`)
  if (caseItem.currency !== 'STARS') {
    throw new Error(`${caseId}: скрипт ожидает кейс с валютой STARS`)
  }

  const result = optimizeCase(caseId, caseItem.price, targetRtp, caseItem.prizes)
  for (const item of result.items) {
    updatedSource = updateChanceInSource(updatedSource, caseId, item.prize.id, formatChance(item.units))
  }
  summaries.push({ id: caseId, target: targetRtp, oldRtp: result.oldRtp, newRtp: result.newRtp })
}

await writeFile(sourcePath, updatedSource, 'utf8')
for (const summary of summaries) {
  console.log(
    `${summary.id}: RTP ${summary.oldRtp.toFixed(4)}% -> ${summary.newRtp.toFixed(4)}% (цель ${summary.target}%)`,
  )
}
