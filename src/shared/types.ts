/** 全局数据契约：房主大屏、玩家手机、服务端游戏引擎共用。 */

import type { VoiceSignal } from './voice'

export type JudgeMode = 'ai' | 'human'
export type Role = 'host' | 'player' | 'referee' | 'watcher'

/** 房间号长度：公网部署后它是进入房间的唯一门槛，所以取 6 位 */
export const ROOM_CODE_LENGTH = 6

/* ------------------------------------------------------------------ *
 * 问卷 → 推荐
 * ------------------------------------------------------------------ */

export type Vibe = 'laugh' | 'warm' | 'brain' | 'rival'
export type Setting = 'seated' | 'standing' | 'lounging'
export type Intimacy = 'strangers' | 'colleagues' | 'friends' | 'family'

/** 用户填写的需求名单 */
export interface Profile {
  count: number
  minutes: number
  setting: Setting
  vibes: Vibe[]
  intimacy: Intimacy
  shyLevel: 0 | 1 | 2
  propsOk: boolean
  phonePerPerson: boolean
  wantMove: boolean
}

export interface GameNeeds {
  move: boolean
  props: string[]
  thinking: 0 | 1 | 2
  chaos: 0 | 1 | 2
  warmth: 0 | 1 | 2
  rivalry: 0 | 1 | 2
  talking: 0 | 1 | 2
  shyFriendly: 0 | 1 | 2
  phones: 'none' | 'some' | 'each'
}

export interface GameMeta {
  id: string
  name: string
  latin: string
  emoji: string
  tagline: string
  desc: string
  minPlayers: number
  maxPlayers: number
  bestPlayers: [number, number]
  minutes: [number, number]
  needs: GameNeeds
  judgeModes: JudgeMode[]
  judgeNote: string
  howTo: string[]
  props: string[]
  color: string
}

export interface Recommendation {
  gameId: string
  score: number
  percent: number
  why: string[]
  watch: string[]
}

/* ------------------------------------------------------------------ *
 * 房间
 * ------------------------------------------------------------------ */

export interface Player {
  id: string
  name: string
  seat: number
  isHost: boolean
  connected: boolean
  lastSeen: number
  /** 上一次喊话时间，用于节流，避免刷屏把裁判播报挤出事件列表 */
  lastChatAt: number
  score: number
  alive: boolean
  outReason: string | null
  /** 自选头像 id（src/shared/avatars.ts）；老房间可能没有，按座位号兜底 */
  avatar?: string
  /** 累计发言/表演时长（ms），轮到本人发言时由服务端累加；老房间没有，按 0 兜底 */
  speakMs?: number
  /** 是否开着麦；语音流走 P2P，这里只广播状态，老房间没有按 false 兜底 */
  micOn?: boolean
  /** 退出对局去观战：座位保留，引擎跳过他，观战席里可以被人接替 */
  watching?: boolean
  /** 座位被观战者接替后，新主人的令牌；认证认它，不再认原来的 id */
  claimToken?: string
}

/** 具名观战者：不进游戏池，能看公开局势、聊天，大厅里可加入、局中可接替空位 */
export interface Spectator {
  id: string
  name: string
  avatar: string
  lastSeen: number
}

/** 下发给各端的观战席条目；seat 非空表示这是一个保留中的空位，可接替 */
export interface SpectatorInfo {
  id: string
  name: string
  avatar: string
  connected: boolean
  seat: number | null
}

/** 房间聊天：和裁判播报分开的一条流，所有端都能看到 */
export interface ChatMessage {
  id: number
  by: string
  name: string
  avatar: string
  text: string
  at: number
}

export interface RoomEvent {
  seq: number
  at: number
  kind: 'info' | 'judge' | 'score' | 'join' | 'chat'
  text: string
}

export interface Room {
  code: string
  createdAt: number
  updatedAt: number
  seq: number
  gameId: string
  /** 有变体的游戏（目前只有狼人杀）在这里记玩家选的那一版 */
  variant?: string
  profile: Profile
  judgeMode: JudgeMode
  refereeId: string | null
  /** 房主是否也作为玩家参加（开局前在大厅里选）；false 时房主只主持，不进游戏池 */
  hostPlays: boolean

  phase: string
  round: number
  turn: number
  startedAt: number | null
  deadlineAt: number | null
  pausedMs: number

  /** 房主设定的每人轮次发言上限（秒）；null/缺省表示用各游戏默认值 */
  speakSeconds?: number | null
  /** 当前正在发言/表演的玩家 id；不在发言阶段为 null */
  speakingId?: string | null
  /** 当前这一位发言开始的时刻，用于累计本人时长 */
  turnStartedAt?: number | null

  players: Player[]
  /** 具名观战者（不含保留座位的退出玩家，那些人还在 players 里带 watching 标记） */
  spectators?: Spectator[]
  /** 被房主踢出的令牌，view 轮询时据此给出明确提示 */
  kickedIds?: string[]
  data: GameData
  events: RoomEvent[]
  chat?: ChatMessage[]
  /** WebRTC 信令信箱（语音开麦），随房间存转；语音流本身不经过服务器 */
  voice?: VoiceSignal[]
  voiceSeq?: number
  finished: FinalResult | null
}

/** 结算排行榜上的一行：全员按分排名，同分同名 */
export interface BoardEntry {
  rank: number
  name: string
  score: number
  /** 胜利方成员（团队游戏）或冠军（个人游戏） */
  win: boolean
}

export interface FinalResult {
  title: string
  lines: string[]
  winners: { name: string; score: number }[]
  verdict: string
  /** 全员排行榜，服务端结算时统一生成；老房间可能没有 */
  board?: BoardEntry[]
}

/** 每个游戏把自己的私密状态塞进对应的可选字段。 */
export interface GameData {
  spy?: SpyData
  twos?: TwosData
  soup?: SoupData
  bomb?: BombData
  seven?: SevenData
  story?: StoryData
  never?: NeverData
  mime?: MimeData
  werewolf?: WerewolfData
}

/* ---------------------------- 谁是卧底 ---------------------------- */
/** oral：大家开口说，手机只负责发词和推进；typed：每人在手机上打字 */
export type SpyDescribeMode = 'oral' | 'typed'

export interface SpyData {
  common: string
  insider: string
  insiderCount: number
  /** 房主指定的卧底数，null 表示按人数自动 */
  insiderPref: number | null
  describeMode: SpyDescribeMode
  round: number
  /** 最多几轮（第 maxRound 轮结束还没分出胜负就算卧底赢） */
  maxRound: number
  /** 本轮描述顺序（playerId） */
  order: string[]
  /** 平票后进入加时投票的候选人（playerId）；空数组表示这是普通一轮 */
  runoff: string[]
  /** playerId -> 分到的词 */
  words: Record<string, string>
  descriptions: Record<string, string>
  votes: Record<string, string>
  tally: Record<string, number>
  eliminated: string[]
  lastOut: string | null
  result: 'civilians' | 'insider' | null
}

/* ---------------------------- 两真一假 ---------------------------- */
export interface TwosCard {
  statements: string[]
  lieIndex: number
}
export interface TwosData {
  /** playerId -> 三条陈述 */
  cards: Record<string, TwosCard | null>
  /** 公开顺序（playerId） */
  order: string[]
  /** 当前正在公开第几个人的三条 */
  cursor: number
  /** authorId -> voterId -> 猜的下标 */
  votes: Record<string, Record<string, number>>
  /** authorId -> 是否已揭晓 */
  revealed: Record<string, boolean>
  /** authorId -> 被骗过的人数 */
  fooled: Record<string, number>
  /** 已经写完三条的人数 */
  waiting: number
}

/* ----------------------------- 海龟汤 ----------------------------- */
export type SoupAnswer = 'yes' | 'no' | 'partial' | 'none' | 'pending'
export interface SoupQuestion {
  id: string
  by: string
  byName: string
  text: string
  answer: SoupAnswer
  at: number
}
export interface SoupData {
  puzzleId: string
  title: string
  tags: string[]
  question: string
  truth: string
  /** 玩家提交的是非问句队列 */
  queue: SoupQuestion[]
  /** playerId -> 提问次数，用于评「最会提问奖」 */
  asked: Record<string, number>
  hintsUsed: number
  /** 有人举手宣布知道了 */
  declaredBy: string | null
  declaredAnswer: string
  solved: boolean
  solvedBy: string | null
  startedAt: number
  elapsedMs: number
}

/* ----------------------------- 数字炸弹 ----------------------------- */
export interface BombData {
  /** 当前区间 [low, high]，闭区间 */
  low: number
  high: number
  target: number
  history: { by: string; value: number }[]
  order: string[]
  cursor: number
  round: number
  maxRound: number
  /** playerId -> 踩雷次数 */
  booms: Record<string, number>
  loser: string | null
}

/* ------------------------------ 逢七过 ------------------------------ */
export interface SevenData {
  /** 下一个该处理的数字 */
  count: number
  /** 报数顺序（playerId） */
  order: string[]
  cursor: number
  /** playerId -> 失误次数 */
  mistakes: Record<string, number>
  /** 累计 3 次失误淘汰的人 */
  struck: string[]
  lastCall: { by: string; expect: number; kind: 'say' | 'pass'; correct: boolean } | null
  /** 每人反应时限（ms），会随数字变大而收紧 */
  speedMs: number
}

/* ----------------------------- 故事接龙 ----------------------------- */
export interface StoryPart {
  by: string
  byName: string
  text: string
  round: number
  score: number
  note: string
}
export interface StoryData {
  opening: string
  constraint: string
  parts: StoryPart[]
  /** playerId -> 本轮草稿，用于刷新页面不丢字 */
  drafts: Record<string, string>
  round: number
  maxRound: number
  scores: Record<string, number>
  /** 本轮最佳句子的 playerId */
  best: Record<number, string>
}

/* ---------------------------- 我有你没有 ---------------------------- */
export interface NeverData {
  /** playerId -> 出题内容 */
  claims: Record<string, string>
  order: string[]
  cursor: number
  /** 出题者 playerId -> 承认「我做过」的人的 playerId 列表 */
  didIt: Record<string, string[]>
  settled: Record<string, boolean>
  /** 出题者 -> 冷门加成 */
  cold: Record<string, number>
  /** 每人初始分 */
  startScore: number
}

/* ----------------------------- 你比我猜 ----------------------------- */
export interface MimeLogItem {
  word: string
  ok: boolean
  by: string
  seconds: number
}
export interface MimeData {
  difficulty: 'easy' | 'mid' | 'hard'
  /** 本场词表 */
  list: string[]
  index: number
  /** 当前比划者 */
  actorId: string | null
  correct: number
  skips: number
  streak: number
  bestStreak: number
  log: MimeLogItem[]
  /** 单轮时长 ms */
  timeMs: number
  round: number
  maxRound: number
  /** 每位比划者的得分 */
  scores: Record<string, number>
}

/* ------------------------------ 狼人杀 ------------------------------ */
export type WolfRole = 'wolf' | 'seer' | 'witch' | 'guard' | 'villager'
export type WolfVariantId = 'quick' | 'classic' | 'full'

/** 夜里各自提交的东西，按玩家 id 存；换阶段时整体清空 */
export interface WolfNightState {
  /** 狼人 playerId -> 刀谁 */
  wolfVotes: Record<string, string>
  /** 预言家查谁 */
  seerPick: string | null
  /** 这一晚查到的结果 */
  seerSeen: { id: string; role: WolfRole } | null
  /** 女巫这一晚的动作：save / poison:<id> / skip */
  witchAct: string | null
  /** 守卫守谁 */
  guardPick: string | null
}

export interface WerewolfData {
  variant: WolfVariantId
  /** playerId -> 身份；只私发给本人，死者白天公开 */
  roles: Record<string, WolfRole>
  /** 第几夜，和 room.round 同步 */
  night: number
  nightState: WolfNightState
  /** 天亮后公布：昨晚死的人（按座位序） */
  killed: string[]
  /** 被毒死的人（单独标出来，方便播报） */
  poisoned: string | null
  /** 守中了狼刀，被救下来的人 */
  saved: string | null
  /** 已经出局的人（夜里死的 + 投出去的） */
  dead: string[]
  /** 死者身份，白天公开 */
  deadRoles: Record<string, WolfRole>
  /** 白天发言顺序 */
  order: string[]
  cursor: number
  speeches: Record<string, string>
  votes: Record<string, string>
  tally: Record<string, number>
  /** 上一轮被投出去的人 */
  exiled: string | null
  win: 'wolf' | 'village' | null
  /** 女巫还剩哪几瓶药 */
  potions: { save: boolean; poison: boolean }
  /** 守卫上一晚守的人（不能连着守同一个人） */
  lastGuard: string | null
  /** 预言家查过的记录，只私发给预言家 */
  history: { night: number; id: string; role: WolfRole }[]
}

/* ------------------------------------------------------------------ *
 * 下发给某一端的视图：服务端按角色脱敏
 * ------------------------------------------------------------------ */

export interface RoomView {
  code: string
  seq: number
  gameId: string
  meta: GameMeta
  phase: string
  round: number
  turn: number
  deadlineAt: number | null
  serverNow: number
  /** 房主设定的每人轮次发言上限（秒），null 表示用默认 */
  speakSeconds: number | null
  /** 当前发言者 id 与其开始时刻，前端据此实时显示本人已发言时长 */
  speakingId: string | null
  turnStartedAt: number | null
  judgeMode: JudgeMode
  refereeId: string | null
  hostPlays: boolean
  role: Role
  me: Player | null
  players: Player[]
  /** 观战席：具名观战者 + 保留座位的退出玩家（seat 非空即可接替的空位） */
  spectators: SpectatorInfo[]
  /** 本人是观战者时的身份卡；玩家/房主/裁判为 null */
  watchMe: { id: string; name: string; avatar: string; seat: number | null } | null
  /** 本次请求使用的令牌；语音等模块要用它而不是 me.id（接替后两者不同） */
  myToken: string | null
  events: RoomEvent[]
  chat: ChatMessage[]
  finished: FinalResult | null
  /** 服务端已脱敏的公开数据，字段结构由各游戏自己决定 */
  publicData: Record<string, any>
  secret: Record<string, unknown>
  /** 仅房主（AI 裁判模式）或受命裁判可见 */
  referee: Record<string, any> | null
  needs: ViewNeeds
}

export interface ViewNeeds {
  /** 需要每个玩家做点什么 */
  prompt: string | null
  /**
   * options 非空时优先按按钮组渲染（忽略 input 的默认控件），
   * value 原样放进 act 的 payload 对应字段。
   */
  input: 'none' | 'text' | 'textarea' | 'number' | 'three' | 'pick'
  inputHint: string
  submitted: boolean
  /** 供按钮组/选择器使用 */
  options?: { value: string | number; label: string; hint?: string }[]
  /** 提交时 payload 里承载选中值的字段名，默认 'value' */
  valueKey?: string
  /** 大屏上的主持人提示 */
  hostHint: string
}
