import type { DropEvent } from '@prisma/client'
import { prisma } from '../db/prisma.js'

/**
 * Что выиграл игрок — от этого зависит, попадёт ли дроп в ленту.
 * В старых записях встречается 'PVP' (победы в рулетке в ленту больше не пишутся).
 */
export type DropItemType = 'NFT' | 'STARS'

export interface LogDropParams {
  userId: bigint
  username?: string | null
  eventType: 'case' | 'upgrader'
  itemName: string
  itemType?: DropItemType | null
  itemEmoji?: string | null
  itemPrice: number
  sourceName?: string | null
  sourceEmoji?: string | null
}

/**
 * Запись дропа в публичную ленту.
 * Fire-and-forget: вызывающий код не должен ждать результат,
 * поэтому ошибки логируются, а игра продолжается.
 */
export async function logDrop(params: LogDropParams): Promise<void> {
  await prisma.dropEvent.create({
    data: {
      userId: params.userId,
      username: params.username ?? null,
      eventType: params.eventType,
      itemName: params.itemName,
      itemType: params.itemType ?? null,
      itemEmoji: params.itemEmoji ?? null,
      itemPrice: params.itemPrice,
      sourceName: params.sourceName ?? null,
      sourceEmoji: params.sourceEmoji ?? null,
    },
  })
}

/**
 * Публичная лента: NFT-дропы из кейсов (любой цены) и крупные выигрыши
 * в Апгрейдере. Звёздные дропы из кейсов (itemType='STARS'), PvP-победы
 * и старые записи без itemType в ленту не попадают.
 */
export async function getFeed(limit = 30): Promise<DropEvent[]> {
  return prisma.dropEvent.findMany({
    where: {
      OR: [{ itemType: 'NFT' }, { eventType: 'upgrader' }],
    },
    orderBy: { createdAt: 'desc' },
    take: limit,
  })
}

/**
 * Отображаемое имя игрока: username, иначе firstName,
 * иначе безопасный псевдоним из последних 4 цифр id.
 */
export async function getUsername(userId: bigint): Promise<string> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { username: true, firstName: true },
  })

  const name = user?.username?.trim() || user?.firstName?.trim()
  if (name) {
    return name
  }

  return `Player #${String(userId).slice(-4)}`
}

/** Публичное представление дропа: BigInt нельзя отдать в JSON как есть. */
export interface DropEventView {
  id: string
  userId: string
  username: string | null
  eventType: string
  itemName: string
  itemType: string | null
  itemEmoji: string | null
  itemPrice: number
  sourceName: string | null
  sourceEmoji: string | null
  createdAt: string
}

export function toDropView(drop: DropEvent): DropEventView {
  return {
    id: drop.id,
    userId: drop.userId.toString(),
    username: drop.username,
    eventType: drop.eventType,
    itemName: drop.itemName,
    itemType: drop.itemType,
    itemEmoji: drop.itemEmoji,
    itemPrice: drop.itemPrice,
    sourceName: drop.sourceName,
    sourceEmoji: drop.sourceEmoji,
    createdAt: drop.createdAt.toISOString(),
  }
}
