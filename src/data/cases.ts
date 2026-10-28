export interface Prize {
  id: string
  name: string
  emoji: string
  type: 'NFT' | 'BALANCE'
  price: number
  chance?: number
}

export interface CaseItem {
  id: string
  name: string
  price: number
  currency: 'STARS' | 'TON'
  emoji: string
  tonPrice?: number
  prizes: Prize[]
}
