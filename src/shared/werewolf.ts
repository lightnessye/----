import type { WolfRole, WolfVariantId } from './types'

/**
 * 狼人杀三种规模。人数和角色固定，方便现场直接对号入座：
 * 6 人去掉女巫和守卫，9 人加女巫，12 人再加守卫，正好对应
 * 小桌、常规、大桌三种场景。
 */
export interface WolfVariant {
  id: WolfVariantId
  name: string
  seats: number
  minutes: string
  tagline: string
  roster: string
  roles: Record<WolfRole, number>
}

export const WOLF_VARIANTS: WolfVariant[] = [
  {
    id: 'quick',
    name: '速战',
    seats: 6,
    minutes: '15 分钟',
    tagline: '两狼一预言家，没有药，全靠嘴硬',
    roster: '2 狼人 · 1 预言家 · 3 村民',
    roles: { wolf: 2, seer: 1, witch: 0, guard: 0, villager: 3 },
  },
  {
    id: 'classic',
    name: '经典',
    seats: 9,
    minutes: '30 分钟',
    tagline: '女巫的一瓶解药一瓶毒药，桌游店最常见的那一版',
    roster: '3 狼人 · 1 预言家 · 1 女巫 · 4 村民',
    roles: { wolf: 3, seer: 1, witch: 1, guard: 0, villager: 4 },
  },
  {
    id: 'full',
    name: '全角色',
    seats: 12,
    minutes: '45 分钟',
    tagline: '守卫也上场，好人三件套凑齐',
    roster: '4 狼人 · 1 预言家 · 1 女巫 · 1 守卫 · 5 村民',
    roles: { wolf: 4, seer: 1, witch: 1, guard: 1, villager: 5 },
  },
]

const BY_ID = new Map<string, WolfVariant>(WOLF_VARIANTS.map((v) => [v.id, v]))

export const wolfVariant = (id?: string | null): WolfVariant =>
  (id ? BY_ID.get(id) : undefined) ?? WOLF_VARIANTS[1]

export const isWolf = (role: WolfRole) => role === 'wolf'

export const ROLE_LABEL: Record<WolfRole, string> = {
  wolf: '狼人',
  seer: '预言家',
  witch: '女巫',
  guard: '守卫',
  villager: '村民',
}

export const ROLE_DESC: Record<WolfRole, string> = {
  wolf: '每晚和队友一起刀一个人，白天装成好人混过去。',
  seer: '每晚可以查一个人，知道他是好人还是狼人。',
  witch: '一瓶解药一瓶毒药，各只能用一次；解药能救下今晚被刀的人。',
  guard: '每晚守一个人，他今晚不会死；不能连着两晚守同一个人。',
  villager: '没有技能，靠发言和投票把狼人找出来。',
}

/** 夜里需要行动的角色（有人活着才算这一步） */
export const NIGHT_ROLES: WolfRole[] = ['wolf', 'seer', 'witch', 'guard']
