import type {
  BombData,
  BoardEntry,
  GameData,
  MimeData,
  NeverData,
  Player,
  Room,
  SevenData,
  SoupData,
  SpyData,
  StoryData,
  TwosData,
  WerewolfData,
} from '../types'
import { rankByScore } from '../judge'
import { ROLE_LABEL } from '../werewolf'

/* ---------------------------- 随机 ---------------------------- */

export const randInt = (lo: number, hi: number) => lo + Math.floor(Math.random() * (hi - lo + 1))

export const pick = <T>(arr: readonly T[]): T => arr[Math.floor(Math.random() * arr.length)]

export function shuffle<T>(arr: readonly T[]): T[] {
  const out = arr.slice()
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

export const chance = (p: number) => Math.random() < p

/* ---------------------------- 房间 ---------------------------- */

/** 房主选择只主持（或房主本人就是真人裁判）时，不进游戏池：不发词、不排回合、不计分 */
export const sittingOut = (room: Room, p: Player) =>
  p.isHost &&
  (room.hostPlays === false || (room.judgeMode === 'human' && room.refereeId === p.id))

export const seated = (room: Room) =>
  room.players.filter((p) => !p.watching && !sittingOut(room, p)).sort((a, b) => a.seat - b.seat)

export const alive = (room: Room) => seated(room).filter((p) => p.alive)

export const byId = (room: Room, id: string): Player | undefined =>
  room.players.find((p) => p.id === id)

export const nameOf = (room: Room, id: string | null | undefined) =>
  (id && byId(room, id)?.name) || '某人'

export const isRefereeAct = (room: Room, actor: Player | null) =>
  !!actor && (actor.isHost || room.refereeId === actor.id)

export function addScore(room: Room, id: string, delta: number) {
  const p = byId(room, id)
  if (p) p.score = Math.max(0, p.score + delta)
}

/** 当前阶段还剩下多少秒（无计时返回 null） */
export const secondsLeft = (room: Room, now: number) =>
  room.deadlineAt == null ? null : Math.max(0, Math.ceil((room.deadlineAt - now) / 1000))

export function ev(room: Room, kind: 'info' | 'judge' | 'score' | 'join' | 'chat', text: string) {
  room.seq += 1
  room.events.push({ seq: room.seq, at: Date.now(), kind, text })
  if (room.events.length > 60) room.events.splice(0, room.events.length - 60)
}

/** 切阶段；ms 给了就开倒计时，不给则不倒计时 */
export function phase(room: Room, next: string, opts?: { ms?: number; round?: number; turn?: number }) {
  room.phase = next
  if (opts?.round !== undefined) room.round = opts.round
  if (opts?.turn !== undefined) room.turn = opts.turn
  room.deadlineAt = opts?.ms ? Date.now() + opts.ms : null
  room.updatedAt = Date.now()
}

/** 重新计时但不换阶段 */
export function retime(room: Room, ms: number) {
  room.deadlineAt = Date.now() + ms
}

/** 每人轮次发言上限：房主设了就用他的，没设退回各游戏默认 */
export const speakLimitMs = (room: Room, defaultMs: number) =>
  room.speakSeconds != null ? Math.max(1, room.speakSeconds) * 1000 : defaultMs

/**
 * 当前正在发言/表演的那一位。只认「一人一轮」的阶段：
 * 卧底描述、狼人发言、两真一假公开、我有你没有出题、你比我猜比划。
 * 同时填写/投票的阶段没有单一发言者，返回 null。
 */
export function currentSpeaker(room: Room): string | null {
  const active = (id: string | null | undefined) => {
    const p = id ? byId(room, id) : undefined
    return p && p.alive && !p.watching ? p.id : null
  }
  switch (room.gameId) {
    case 'spy':
      return room.phase === 'describe'
        ? spy(room).order.filter((id) => byId(room, id)?.alive && !byId(room, id)?.watching)[room.turn] ?? null
        : null
    case 'werewolf':
      return room.phase === 'speak' ? active(wolf(room).order[wolf(room).cursor]) : null
    case 'twos':
      return room.phase === 'show' ? active(twos(room).order[twos(room).cursor]) : null
    case 'never':
      return room.phase === 'show' ? active(never(room).order[never(room).cursor]) : null
    case 'mime':
      return room.phase === 'run' ? active(mime(room).actorId) : null
    default:
      return null
  }
}

/**
 * 集中记账：每次 tick/提交/推进后调用。发言者没变就什么都不做（不产生写），
 * 一旦换人，把上一位从 turnStartedAt 到现在的实际耗时累加到他的 speakMs。
 */
export function syncSpeakTimer(room: Room, now: number) {
  const speaker = currentSpeaker(room)
  const prev = room.speakingId ?? null
  if (speaker === prev) return
  if (prev && room.turnStartedAt != null) {
    const p = byId(room, prev)
    if (p) p.speakMs = (p.speakMs ?? 0) + Math.max(0, now - room.turnStartedAt)
  }
  room.speakingId = speaker
  room.turnStartedAt = speaker ? now : null
}

/** 该玩家在本阶段是否已经交过 */
export const submitted = (room: Room, id: string, key: string) => {
  const d: any = room.data
  for (const bag of Object.values(d ?? {})) {
    if (bag && typeof bag === 'object' && (bag as any)[key]?.[id] !== undefined) return true
  }
  return false
}

/** 所有人都交完了吗 */
export function allSubmitted(room: Room, ids: string[], key: string, bag: keyof GameData) {
  const store: any = (room.data[bag] as any)?.[key]
  if (!store) return false
  return ids.every((id) => store[id] !== undefined && store[id] !== '' && store[id] !== null)
}

/* ------------------------ 各游戏数据取用 ------------------------ */

function slot<T extends object>(room: Room, key: keyof GameData): T {
  if (!(room.data as any)[key]) (room.data as any)[key] = {}
  return (room.data as any)[key] as T
}

export const spy = (room: Room) => slot<SpyData>(room, 'spy')
export const twos = (room: Room) => slot<TwosData>(room, 'twos')
export const soup = (room: Room) => slot<SoupData>(room, 'soup')
export const bomb = (room: Room) => slot<BombData>(room, 'bomb')
export const seven = (room: Room) => slot<SevenData>(room, 'seven')
export const story = (room: Room) => slot<StoryData>(room, 'story')
export const never = (room: Room) => slot<NeverData>(room, 'never')
export const mime = (room: Room) => slot<MimeData>(room, 'mime')
export const wolf = (room: Room) => slot<WerewolfData>(room, 'werewolf')

/* ---------------------------- 结算 ---------------------------- */

const TEAM_WIN_BONUS = 3
const CHAMPION_BONUS = 2

/**
 * 游戏结束时按胜利情况补一次分：团队游戏（卧底/狼人杀）胜利方全员 +3，
 * 个人游戏总分冠军 +2。只在 advance() 的 over && !finished 分支里调用，
 * 那个分支一局只进一次，所以这里不需要自己做幂等。
 */
export function settleWinBonus(room: Room) {
  if (room.gameId === 'spy') {
    const d = spy(room)
    if (!d.result) return
    const insiderWin = d.result === 'insider'
    for (const p of seated(room)) {
      const word = d.words[p.id]
      if (word === undefined) continue
      if ((word !== d.common) === insiderWin) addScore(room, p.id, TEAM_WIN_BONUS)
    }
    ev(room, 'score', `${insiderWin ? '卧底方' : '平民方'}获胜，胜利方每人 +${TEAM_WIN_BONUS} 分。`)
    return
  }
  if (room.gameId === 'werewolf') {
    const d = wolf(room)
    if (!d.win) return
    const wolfWin = d.win === 'wolf'
    for (const p of seated(room)) {
      if ((d.roles[p.id] === 'wolf') === wolfWin) addScore(room, p.id, TEAM_WIN_BONUS)
    }
    ev(room, 'score', `${wolfWin ? '狼人' : '好人'}赢下这一局，胜利方每人 +${TEAM_WIN_BONUS} 分。`)
    return
  }
  const top = seated(room).slice().sort((a, b) => b.score - a.score)[0]
  if (!top || top.score <= 0) return
  const champs = seated(room).filter((p) => p.score === top.score)
  for (const p of champs) addScore(room, p.id, CHAMPION_BONUS)
  ev(room, 'score', `冠军 ${champs.map((p) => p.name).join('、')} 各 +${CHAMPION_BONUS} 分。`)
}

/** 全员排行榜：同分同名，标出胜利方；狼人杀顺带公开身份，卧底把只执法的裁判摘出去 */
export function buildBoard(room: Room): BoardEntry[] {
  const pool =
    room.gameId === 'spy'
      ? seated(room).filter((p) => !(room.judgeMode === 'human' && room.refereeId === p.id))
      : seated(room)
  return rankByScore(pool).map((r) => {
    const p = r.player
    let name = p.name
    let win = r.rank === 0 && p.score > 0
    if (room.gameId === 'spy') {
      const d = spy(room)
      const word = d.words[p.id]
      if (d.result && word !== undefined) win = (word !== d.common) === (d.result === 'insider')
    } else if (room.gameId === 'werewolf') {
      const d = wolf(room)
      const role = d.roles[p.id] ?? 'villager'
      name = `${p.name} · ${ROLE_LABEL[role]}`
      if (d.win) win = (role === 'wolf') === (d.win === 'wolf')
    }
    return { rank: r.rank + 1, name, score: p.score, win }
  })
}

/* ---------------------------- 文本 ---------------------------- */

/** 粗略切词：中文按 2-gram，英文按单词。用于本地裁判做关键词命中判断。 */
export function grams(text: string): Set<string> {
  const clean = (text || '').replace(/\s+/g, '')
  const out = new Set<string>()
  const en = clean.toLowerCase().match(/[a-z]{2,}/g) ?? []
  en.forEach((w) => out.add(w))
  for (let i = 0; i < clean.length - 1; i++) out.add(clean.slice(i, i + 2))
  if (clean.length === 1) out.add(clean)
  return out
}

/** a 里有多少个 2-gram 出现在 b 里 */
export function overlap(a: string, b: string): number {
  const ga = grams(a)
  let hit = 0
  for (const g of grams(b)) if (ga.has(g)) hit += 1
  return hit
}

export const containsAny = (text: string, words: string[]) => {
  const t = text || ''
  return words.some((w) => w.length >= 2 && t.includes(w))
}

export const clip = (s: string, n = 60) => {
  const t = (s || '').trim()
  return t.length > n ? t.slice(0, n) + '…' : t
}

/** 玩家输入的清洗：限长、去首尾空白、折叠换行 */
export const sanitize = (s: unknown, max = 200) =>
  String(s ?? '')
    .replace(/\r?\n/g, ' ')
    .trim()
    .slice(0, max)

export const seatLabel = (p: Player) => `${p.seat} 号 · ${p.name}`
