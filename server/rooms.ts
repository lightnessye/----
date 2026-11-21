import type { ChatMessage, GameData, Profile, Room, RoomView, Player, Spectator } from '../src/shared/types'
import { ROOM_CODE_LENGTH } from '../src/shared/types'
import { isPhotoAvatar, sanitizeAvatar } from '../src/shared/avatars'
import { GAME_BY_ID } from '../src/shared/games'
import { isQuickPhrase } from '../src/shared/phrases'
import { engineFor } from '../src/shared/engine'
import { syncSpeakTimer, seated, ev, isRefereeAct, settleWinBonus, buildBoard, phase } from '../src/shared/engine/util'
import { memoryStore, ROOM_TTL_MS, type Loaded, type RoomStore } from './store'

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const TOKEN_CHARS = 'abcdefghijklmnopqrstuvwxyz0123456789'
const PLAYER_OFFLINE_MS = 45_000
/** 在线状态写库的最小间隔，避免每次轮询都产生一次写 */
const PRESENCE_WRITE_MS = 10_000
/** 喊话节流：事件列表只留 60 条，刷屏会把裁判播报挤掉 */
const SAY_COOLDOWN_MS = 2_000
const CAS_ATTEMPTS = 4
const CHAT_MAX_LEN = 200
const CHAT_KEEP = 120
const CHAT_VIEW = 60
/** 同一人两条消息的最小间隔，防刷屏 */
const CHAT_COOLDOWN_MS = 700

export interface CreateInput {
  profile: Profile
  gameId: string
  judgeMode: 'ai' | 'human'
  hostName: string
  hostAvatar?: string
  /** 有变体的游戏（狼人杀）在这里带上玩家选的那一版 */
  variant?: string
}

let store: RoomStore = memoryStore()

/** 换房间存储：本机 Express 用内存，Sites Function 用数据库 */
export function useRoomStore(next: RoomStore) {
  store = next
}

/** 房间号和玩家令牌在公网部署后就是访问凭证，不能用 Math.random */
function randomPick(alphabet: string, length: number) {
  const limit = 256 - (256 % alphabet.length)
  let out = ''
  while (out.length < length) {
    const bytes = new Uint8Array(length * 2)
    crypto.getRandomValues(bytes)
    for (const b of bytes) {
      if (out.length >= length) break
      if (b < limit) out += alphabet[b % alphabet.length]
    }
  }
  return out
}

async function makeCode() {
  for (let attempt = 0; attempt < 40; attempt++) {
    const code = randomPick(CODE_CHARS, ROOM_CODE_LENGTH)
    if (!(await store.load(code))) return code
  }
  return randomPick(CODE_CHARS, ROOM_CODE_LENGTH)
}

const makeToken = () => randomPick(TOKEN_CHARS, 32)

export function normalize(code: string) {
  return String(code ?? '').trim().toUpperCase().slice(0, ROOM_CODE_LENGTH)
}

/** 令牌 → 玩家。座位被接替后认 claimToken，原主人的令牌随之失效 */
export const findPlayer = (room: Room, token: string | null): Player | null =>
  token ? room.players.find((p) => (p.claimToken ?? p.id) === token) ?? null : null

export const findSpectator = (room: Room, token: string | null): Spectator | null =>
  token ? (room.spectators ?? []).find((s) => s.id === token) ?? null : null

/** 头像入参清洗：照片 dataURL 原样保留（限长），其余按短 id 处理 */
export const cleanAvatarInput = (v: unknown): string | undefined => {
  if (typeof v !== 'string') return undefined
  return isPhotoAvatar(v) ? v : String(v).slice(0, 24)
}

export function sanitizeName(name: unknown) {
  return String(name ?? '').replace(/\s+/g, ' ').trim().slice(0, 12)
}

export type MutateResult<T> =
  | { ok: true; value: T; room: Room }
  | { ok: false; reason: 'not_found' | 'conflict' }

/** 读房间 → 改 → 按 seq 写回；写回撞车就重读再来 */
export async function mutateRoom<T>(code: string, fn: (room: Room) => T): Promise<MutateResult<T>> {
  for (let attempt = 0; attempt < CAS_ATTEMPTS; attempt++) {
    const loaded = await store.load(code)
    if (!loaded) return { ok: false, reason: 'not_found' }
    const value = fn(loaded.room)
    if (JSON.stringify(loaded.room) === loaded.json) return { ok: true, value, room: loaded.room }
    // 版本号必须前进，否则只改 lastSeen 这类不动 seq 的写入躲得过并发检查
    loaded.room.seq = Math.max(loaded.room.seq, loaded.expectedSeq + 1)
    if (await store.commit(loaded, loaded.room)) return { ok: true, value, room: loaded.room }
  }
  return { ok: false, reason: 'conflict' }
}

/** 每次请求顺带把时间往前推一格，替代常驻进程里的 setInterval */
export function advance(room: Room, now: number) {
  const engine = engineFor(room.gameId)
  if (!engine) return
  try {
    engine.tick(room, now)
  } catch (err) {
    console.error('[tick]', room.code, room.gameId, err)
    room.seq += 1
    room.events.push({ seq: room.seq, at: now, kind: 'info', text: '裁判这边卡了一下，按「下一步」继续。' })
  }
  if (room.phase === 'over' && !room.finished) {
    try {
      settleWinBonus(room)
      room.finished = engine.finish(room)
    } catch (err) {
      console.error('[finish]', room.code, err)
      room.finished = {
        title: '本局结束',
        lines: [],
        winners: [],
        verdict: '结算时裁判打了个盹，分数以现场记忆为准。',
      }
    }
    room.finished.board = buildBoard(room)
  }
  syncSpeakTimer(room, now)
}

export async function createRoom(input: CreateInput): Promise<{ room: Room; host: Player }> {
  const meta = GAME_BY_ID[input.gameId]
  if (!meta) throw new Error('unknown game')
  const engine = engineFor(input.gameId)
  if (!engine) throw new Error('engine missing')

  const code = await makeCode()
  const now = Date.now()
  const host: Player = {
    id: makeToken(),
    name: sanitizeName(input.hostName) || '房主',
    seat: 1,
    isHost: true,
    connected: true,
    lastSeen: now,
    lastChatAt: 0,
    score: 0,
    alive: true,
    outReason: null,
    avatar: sanitizeAvatar(input.hostAvatar, 1),
    speakMs: 0,
  }

  const room: Room = {
    code,
    createdAt: now,
    updatedAt: now,
    seq: 1,
    gameId: input.gameId,
    variant: input.variant ?? '',
    profile: input.profile,
    judgeMode: meta.judgeModes.includes(input.judgeMode) ? input.judgeMode : meta.judgeModes[0],
    refereeId: null,
    hostPlays: true,
    phase: 'lobby',
    round: 0,
    turn: 0,
    startedAt: null,
    deadlineAt: null,
    pausedMs: 0,
    speakSeconds: null,
    speakingId: null,
    turnStartedAt: null,
    players: [host],
    spectators: [],
    kickedIds: [],
    data: {} as GameData,
    events: [],
    chat: [],
    finished: null,
  }

  engine.create(room)
  touch(room)
  if (!(await store.insert(room))) throw new Error('code taken')
  return { room, host }
}

export const loadRoom = (code: string): Promise<Loaded | null> => store.load(normalize(code))

export async function joinRoom(
  code: string,
  name: string,
  avatar?: string,
): Promise<{ room: Room; player: Player } | null> {
  const clean = sanitizeName(name)
  if (!clean) return null
  const result = await mutateRoom(normalize(code), (room) => {
    if (room.phase !== 'lobby') return null
    const meta = GAME_BY_ID[room.gameId]
    if (meta && room.players.length >= meta.maxPlayers) return null

    const taken = new Set(room.players.map((p) => p.name))
    let finalName = clean
    let n = 2
    while (taken.has(finalName)) finalName = `${clean}${n++}`

    const seat = room.players.reduce((m, p) => Math.max(m, p.seat), 0) + 1
    const player: Player = {
      id: makeToken(),
      name: finalName,
      seat,
      isHost: false,
      connected: true,
      lastSeen: Date.now(),
      lastChatAt: 0,
      score: 0,
      alive: true,
      outReason: null,
      avatar: sanitizeAvatar(avatar, seat),
      speakMs: 0,
    }
    room.players.push(player)
    room.seq += 1
    room.events.push({
      seq: room.seq,
      at: Date.now(),
      kind: 'join',
      text: `${player.name} 加入，现在 ${room.players.length} 个人`,
    })
    touch(room)
    return { room, player }
  })
  return result.ok ? result.value : null
}

export function touch(room: Room) {
  room.updatedAt = Date.now()
  if (room.events.length > 60) room.events.splice(0, room.events.length - 60)
}

const SPECTATOR_MAX = 40

/** 具名观战：任何阶段都能进，只看不玩；大厅里可加入对局，局中可接替空位 */
export async function watchJoin(
  code: string,
  name: string,
  avatar?: string,
): Promise<{ room: Room; spectator: Spectator } | null> {
  const clean = sanitizeName(name)
  if (!clean) return null
  const result = await mutateRoom(normalize(code), (room) => {
    const specs = room.spectators ?? (room.spectators = [])
    if (specs.length >= SPECTATOR_MAX) return null
    const taken = new Set([...room.players.map((p) => p.name), ...specs.map((s) => s.name)])
    let finalName = clean
    let n = 2
    while (taken.has(finalName)) finalName = `${clean}${n++}`
    const spectator: Spectator = {
      id: makeToken(),
      name: finalName,
      avatar: sanitizeAvatar(avatar, specs.length + 1),
      lastSeen: Date.now(),
    }
    specs.push(spectator)
    room.seq += 1
    room.events.push({ seq: room.seq, at: Date.now(), kind: 'join', text: `${finalName} 坐上了观战席` })
    touch(room)
    return { room, spectator }
  })
  return result.ok ? result.value : null
}

/* ---------------------------- 房主管理（开局前） ---------------------------- */

export function kickPlayer(room: Room, hostToken: string, targetId: string): string | null {
  const host = findPlayer(room, hostToken)
  if (!host?.isHost) return '只有房主能踢人'
  if (room.phase !== 'lobby') return '开局之后就不能踢人了'
  const target = room.players.find((p) => p.id === targetId)
  if (!target) return '找不到这名玩家'
  if (target.isHost) return '房主不能被踢'
  room.players = room.players.filter((p) => p.id !== targetId)
  const kicked = room.kickedIds ?? (room.kickedIds = [])
  kicked.push(target.id)
  if (target.claimToken) kicked.push(target.claimToken)
  if (kicked.length > 60) kicked.splice(0, kicked.length - 60)
  if (room.voice?.length) room.voice = room.voice.filter((s) => s.from !== targetId && s.to !== targetId)
  ev(room, 'join', `${target.name} 被房主请出了房间`)
  touch(room)
  return null
}

/** 解散前的校验；真正删库由路由层在校验通过后调 removeRoom */
export function checkDisband(room: Room, hostToken: string): string | null {
  const host = findPlayer(room, hostToken)
  if (!host?.isHost) return '只有房主能解散房间'
  if (room.phase !== 'lobby') return '开局之后不能解散，可以先「提前结束」再回大厅'
  return null
}

export const removeRoom = (code: string) => store.remove(normalize(code))

/* ---------------------------- 大厅重置 / 换游戏 / 再来一局 ---------------------------- */

function resetToLobby(room: Room) {
  room.phase = 'lobby'
  room.round = 0
  room.turn = 0
  room.startedAt = null
  room.deadlineAt = null
  room.pausedMs = 0
  room.speakingId = null
  room.turnStartedAt = null
  room.finished = null
  room.data = {} as GameData
  for (const p of room.players) {
    p.score = 0
    p.alive = true
    p.outReason = null
    p.speakMs = 0
  }
}

/** 大厅里换游戏：人留着，引擎状态整个重来 */
export function switchGame(room: Room, hostToken: string, gameId: string): string | null {
  const host = findPlayer(room, hostToken)
  if (!host?.isHost) return '只有房主能换游戏'
  if (room.phase !== 'lobby') return '开局之后不能换游戏'
  const meta = GAME_BY_ID[gameId]
  const engine = engineFor(gameId)
  if (!meta || !engine) return '没有这个游戏'
  if (gameId === room.gameId) return null
  if (room.players.length > meta.maxPlayers) {
    return `${meta.name} 最多 ${meta.maxPlayers} 人，现在 ${room.players.length} 人，先请几位去观战席`
  }
  room.gameId = gameId
  room.variant = ''
  if (!meta.judgeModes.includes(room.judgeMode)) room.judgeMode = meta.judgeModes[0]
  if (room.judgeMode === 'ai') room.refereeId = null
  resetToLobby(room)
  engine.create(room)
  ev(room, 'info', `房主把游戏换成了「${meta.name}」，大家重新准备`)
  touch(room)
  return null
}

/** 结算后回到组队大厅：同一批人，可以换游戏再开一局 */
export function restartRoom(room: Room, hostToken: string): string | null {
  const host = findPlayer(room, hostToken)
  if (!host?.isHost) return '只有房主能开下一局'
  if (room.phase !== 'over') return '这局还没结束'
  resetToLobby(room)
  const engine = engineFor(room.gameId)
  if (!engine) return '游戏引擎缺失'
  engine.create(room)
  ev(room, 'info', '回到组队大厅，房主可以换游戏或直接再开一局')
  touch(room)
  return null
}

/** 房主在 lobby 里设定裁判模式、真人裁判、本人身份、轮次时长，以及换游戏 */
export function configureRoom(
  room: Room,
  opts: { judgeMode?: 'ai' | 'human'; refereeId?: string | null; variant?: string; speakSeconds?: number | null; hostPlays?: boolean; gameId?: string; hostToken?: string; game?: Record<string, unknown> },
): string | null {
  if (opts.gameId !== undefined) {
    const err = switchGame(room, opts.hostToken ?? '', opts.gameId)
    if (err) return err
  }
  const meta = GAME_BY_ID[room.gameId]
  if (opts.variant !== undefined) {
    if (room.phase !== 'lobby') return '开局之后不能换模式了'
    room.variant = String(opts.variant || '')
  }
  if (opts.hostPlays !== undefined) {
    if (room.phase !== 'lobby') return '开局之后不能改房主身份了'
    room.hostPlays = !!opts.hostPlays
  }
  if (opts.speakSeconds !== undefined) {
    if (room.phase !== 'lobby') return '轮次时间开局后就锁定了，回大厅再调'
    if (opts.speakSeconds === null) {
      room.speakSeconds = null
    } else {
      const n = Math.round(Number(opts.speakSeconds))
      if (!Number.isFinite(n)) return '发言时长得是个数字'
      room.speakSeconds = Math.max(10, Math.min(300, n))
    }
  }
  if (opts.judgeMode) {
    if (!meta.judgeModes.includes(opts.judgeMode)) return `${meta.name} 不支持这种裁判方式`
    room.judgeMode = opts.judgeMode
    if (opts.judgeMode === 'ai') room.refereeId = null
  }
  if (opts.refereeId !== undefined) {
    if (room.judgeMode !== 'human') return '当前是 AI 裁判，先切换成真人裁判'
    if (opts.refereeId === null) {
      room.refereeId = null
    } else {
      const p = room.players.find((x) => x.id === opts.refereeId)
      if (!p) return '找不到这名玩家'
      room.refereeId = p.id
    }
  }
  if (opts.game) {
    const engine = engineFor(room.gameId)
    if (!engine?.configure) return '这个游戏没有可调的配置'
    const err = engine.configure(room, opts.game)
    if (err) return err
  }
  if (room.judgeMode === 'human' && !room.refereeId && room.phase === 'lobby') {
    return '还差一步：指定一名真人裁判'
  }
  touch(room)
  return null
}

export function startRoom(room: Room, hostToken: string): string | null {
  if (room.phase !== 'lobby') return '这局已经开始了'
  const host = findPlayer(room, hostToken)
  if (!host?.isHost) return '只有房主能开始这局'
  const meta = GAME_BY_ID[room.gameId]
  if (seated(room).length < meta.minPlayers) return `至少 ${meta.minPlayers} 个人才能开这局`
  if (room.judgeMode === 'human' && !room.refereeId) return '请先指定一名真人裁判'
  const engine = engineFor(room.gameId)
  if (!engine) return '游戏引擎缺失'
  room.startedAt = Date.now()
  room.seq += 1
  engine.start(room)
  touch(room)
  return null
}

/** 把接替/回归的玩家从各游戏的出局名单里捞回来，身份、词、位置都原样保留 */
function reviveSeat(room: Room, p: Player) {
  p.watching = false
  p.alive = true
  p.outReason = null
  p.connected = true
  p.lastSeen = Date.now()
  const sp = room.data.spy
  if (sp) sp.eliminated = sp.eliminated.filter((id) => id !== p.id)
  const wf = room.data.werewolf
  if (wf) {
    wf.dead = wf.dead.filter((id) => id !== p.id)
    delete wf.deadRoles[p.id]
  }
  const sv = room.data.seven
  if (sv) sv.struck = sv.struck.filter((id) => id !== p.id)
}

/** 玩家退出对局去观战：座位保留成空位，引擎按出局跳过，等人接替或自己回来 */
function spectate(room: Room, actor: Player): string | null {
  if (actor.isHost) return '房主不能退到观战席，可以用「解散房间」或先提前结束'
  if (room.judgeMode === 'human' && room.refereeId === actor.id) return '裁判不能退到观战席，先让房主换一名裁判'
  if (actor.watching) return null
  actor.watching = true
  actor.alive = false
  actor.outReason = '退出观战'
  actor.micOn = false
  if (room.voice?.length) room.voice = room.voice.filter((s) => s.from !== actor.id && s.to !== actor.id)
  ev(room, 'info', `${actor.name} 退到观战席，${actor.seat} 号位空出来了，观战的人可以接替`)
  touch(room)
  return null
}

/** 观战者接替一个空位：沿用原座位的一切游戏状态，只换名字头像和令牌 */
function takeover(room: Room, spec: Spectator, targetId?: string): string | null {
  if (room.phase === 'lobby') return '大厅里直接点「加入对局」就行'
  if (room.phase === 'over') return '这局已经结束，等房主回大厅再加入'
  const vacancies = room.players.filter((p) => p.watching)
  const seat = targetId ? vacancies.find((p) => p.id === targetId) : vacancies[0]
  if (!seat) return '现在没有可接替的空位'
  const oldName = seat.name
  const oldToken = seat.id
  room.spectators = (room.spectators ?? []).filter((s) => s.id !== spec.id)
  // 原主人降级为普通观战者，令牌不变，还能继续看
  const specs = room.spectators ?? (room.spectators = [])
  specs.push({ id: oldToken, name: oldName, avatar: sanitizeAvatar(seat.avatar, seat.seat), lastSeen: Date.now() })
  const taken = new Set(room.players.filter((p) => p.id !== seat.id).map((p) => p.name))
  let finalName = spec.name
  let n = 2
  while (taken.has(finalName)) finalName = `${spec.name}${n++}`
  seat.claimToken = spec.id
  seat.name = finalName
  seat.avatar = sanitizeAvatar(spec.avatar, seat.seat)
  seat.micOn = false
  reviveSeat(room, seat)
  ev(room, 'join', `${finalName} 接替了 ${oldName} 的 ${seat.seat} 号位，继续这局`)
  touch(room)
  return null
}

/** 大厅里的观战者正式加入对局 */
function joinPlay(room: Room, spec: Spectator): string | null {
  if (room.phase !== 'lobby') return '已经开局了，只能接替空位'
  const meta = GAME_BY_ID[room.gameId]
  if (meta && room.players.length >= meta.maxPlayers) return `房间满了（最多 ${meta.maxPlayers} 人）`
  room.spectators = (room.spectators ?? []).filter((s) => s.id !== spec.id)
  const seat = room.players.reduce((m, p) => Math.max(m, p.seat), 0) + 1
  const taken = new Set(room.players.map((p) => p.name))
  let finalName = spec.name
  let n = 2
  while (taken.has(finalName)) finalName = `${spec.name}${n++}`
  room.players.push({
    id: spec.id,
    name: finalName,
    seat,
    isHost: false,
    connected: true,
    lastSeen: Date.now(),
    lastChatAt: 0,
    score: 0,
    alive: true,
    outReason: null,
    avatar: sanitizeAvatar(spec.avatar, seat),
    speakMs: 0,
  })
  ev(room, 'join', `${finalName} 从观战席加入对局，现在 ${room.players.length} 个人`)
  touch(room)
  return null
}

/** 聊天和换头像是所有游戏通用的房间操作，不进各游戏引擎 */
function sendChat(room: Room, actor: Player | Spectator, payload: any): string | null {
  const text = String(payload?.text ?? '').replace(/\s+/g, ' ').trim().slice(0, CHAT_MAX_LEN)
  if (!text) return '说点什么再发'
  const chat = room.chat ?? (room.chat = [])
  const now = Date.now()
  for (let i = chat.length - 1; i >= 0; i--) {
    if (chat[i].by === actor.id) {
      if (now - chat[i].at < CHAT_COOLDOWN_MS) return '手速太快啦，缓一秒再发'
      break
    }
  }
  room.seq += 1
  const seat = 'seat' in actor ? actor.seat : 1
  chat.push({
    id: room.seq,
    by: actor.id,
    name: actor.name,
    // 照片头像不内嵌进每条消息（会把房间存储撑爆），下发视图时按当前头像解析
    avatar: isPhotoAvatar(actor.avatar) ? '' : sanitizeAvatar(actor.avatar, seat),
    text,
    at: now,
  })
  if (chat.length > CHAT_KEEP) chat.splice(0, chat.length - CHAT_KEEP)
  touch(room)
  return null
}

/** 喊话是所有游戏共用的一层，不进各引擎 */
function say(room: Room, actor: Player, payload: any): string | null {
  if (!isQuickPhrase(payload?.text)) return '只能发列表里的话'
  const now = Date.now()
  if (now - actor.lastChatAt < SAY_COOLDOWN_MS) return null
  actor.lastChatAt = now
  ev(room, 'chat', `${actor.name}：${payload.text}`)
  touch(room)
  return null
}

export function act(
  room: Room,
  token: string,
  action: string,
  payload: any,
): string | null {
  const engine = engineFor(room.gameId)
  if (!engine) return '游戏引擎缺失'
  if (room.kickedIds?.includes(token)) return '你已被房主移出房间'
  const actor = findPlayer(room, token)
  const spec = actor ? null : findSpectator(room, token)
  if (!actor && !spec) return '身份失效，请重新加入房间'
  if (!/^[a-zA-Z][a-zA-Z0-9]{1,24}$/.test(action)) return '未知操作'

  if (action === 'chat') {
    return sendChat(room, actor ?? spec!, payload)
  }
  if (action === 'avatar') {
    const target = actor ?? spec!
    target.avatar = sanitizeAvatar(payload?.avatar, actor?.seat ?? 1)
    touch(room)
    return null
  }
  if (action === 'spectate') return actor ? spectate(room, actor) : '你已经在观战席了'
  if (action === 'rejoin') {
    if (!actor?.watching) return '你的座位还在，不用回归'
    reviveSeat(room, actor)
    ev(room, 'join', `${actor.name} 回到了自己的 ${actor.seat} 号位`)
    touch(room)
    return null
  }
  if (action === 'takeover') {
    if (!spec) return actor?.watching ? '点「回到我的座位」就能归队' : '你已经在对局里了'
    return takeover(room, spec, typeof payload?.target === 'string' ? payload.target : undefined)
  }
  if (action === 'joinplay') {
    if (!spec) return '你已经在对局里了'
    return joinPlay(room, spec)
  }
  if (!actor) return '观战席只能看和聊天，想玩就加入或接替空位'
  if (action === 'say') return say(room, actor, payload)
  if (action === 'mic') {
    if (actor.watching) return '观战中不能开麦'
    actor.micOn = !!payload?.on
    // 闭麦时清掉和这名玩家相关的信令，别人不会再回复一条已经死掉的连接
    if (!actor.micOn && room.voice?.length) {
      room.voice = room.voice.filter((s) => s.from !== actor.id && s.to !== actor.id)
    }
    touch(room)
    return null
  }
  if (actor.watching) return '你在观战席，先回到座位再操作'
  // 选游戏环节只放行房间级操作（聊天/头像/喊话/麦克风），游戏操作一律挡住
  if (room.phase === 'picking') return '房主正在选游戏，稍等一下'
  engine.act(room, actor, action, payload ?? {})
  touch(room)
  syncSpeakTimer(room, Date.now())
  return null
}

export function nextStep(room: Room, token: string | null): string | null {
  const engine = engineFor(room.gameId)
  if (!engine) return '游戏引擎缺失'
  const actor = findPlayer(room, token)
  if (token && !actor) return '身份失效，请重新加入房间'
  if (actor?.watching) return '你在观战席，不能推进游戏'
  if (room.phase === 'picking') return '房主正在选游戏，先选一个'
  if (room.phase === 'lobby') {
    const err = startRoom(room, actor?.id ?? '')
    syncSpeakTimer(room, Date.now())
    return err
  }
  if (!isRefereeAct(room, actor)) return '只有房主或裁判能推进下一步'
  engine.next(room, actor)
  touch(room)
  syncSpeakTimer(room, Date.now())
  return null
}

/** 房主/裁判提前结束：不管进行到哪一步，直接进结算 */
export function forceEnd(room: Room, token: string | null): string | null {
  const actor = findPlayer(room, token)
  if (token && !actor) return '身份失效，请重新加入房间'
  if (!isRefereeAct(room, actor)) return '只有房主或裁判能结束本局'
  if (room.phase === 'lobby') return '还没开局，没有什么可结束的'
  if (room.phase === 'over') return null
  phase(room, 'over')
  ev(room, 'judge', '房主提前结束了这一局，直接结算。')
  touch(room)
  return null
}

/** 结算后房主点「再选游戏」：清掉本局分数和倒计时，进入选游戏阶段。房号、玩家、裁判设置都保留。 */
export function resetToPicking(room: Room, token: string): string | null {
  const host = findPlayer(room, token)
  if (!host?.isHost) return '只有房主能换游戏'
  if (room.phase !== 'over') return '等这局结算完才能换游戏'
  for (const p of room.players) {
    p.score = 0
    if (!p.watching) {
      p.alive = true
      p.outReason = null
    }
  }
  room.phase = 'picking'
  room.round = 0
  room.turn = 0
  room.startedAt = null
  room.deadlineAt = null
  room.pausedMs = 0
  room.finished = null
  room.speakingId = null
  room.turnStartedAt = null
  room.seq += 1
  room.events.push({
    seq: room.seq,
    at: Date.now(),
    kind: 'info',
    text: '本局收工。房主正在挑下一个游戏，大家稍等。',
  })
  touch(room)
  return null
}

/** picking 阶段房主选定下一局：换引擎、重新初始化，回到 lobby，所有端靠轮询同步。 */
export function pickGame(room: Room, token: string, gameId: string): string | null {
  const host = findPlayer(room, token)
  if (!host?.isHost) return '只有房主能选游戏'
  if (room.phase !== 'picking') return '现在不在选游戏环节'
  const meta = GAME_BY_ID[gameId]
  if (!meta) return '没有这个游戏'
  const engine = engineFor(gameId)
  if (!engine) return '游戏引擎缺失'
  const n = seated(room).length
  if (n < meta.minPlayers || n > meta.maxPlayers) {
    return `${meta.name} 要 ${meta.minPlayers}–${meta.maxPlayers} 人，现在 ${n} 人，换一个吧`
  }

  room.gameId = gameId
  room.data = {} as GameData
  for (const p of room.players) {
    p.score = 0
    if (!p.watching) {
      p.alive = true
      p.outReason = null
    }
    p.speakMs = 0
  }
  room.round = 0
  room.turn = 0
  room.startedAt = null
  room.deadlineAt = null
  room.pausedMs = 0
  room.finished = null
  room.variant = ''
  room.speakingId = null
  room.turnStartedAt = null
  // 上一局的语音信令作废，客户端会按新大厅的 micOn 名单重新建连
  room.voice = []
  // 新游戏可能不支持原来的裁判方式（比如只支持 AI 裁判）
  if (!meta.judgeModes.includes(room.judgeMode)) room.judgeMode = meta.judgeModes[0]
  if (room.judgeMode === 'ai') room.refereeId = null
  else if (room.refereeId && !room.players.some((p) => p.id === room.refereeId)) room.refereeId = null

  room.events = []
  room.seq += 1
  room.events.push({
    seq: room.seq,
    at: Date.now(),
    kind: 'info',
    text: `房主选了《${meta.name}》，人齐了就开。`,
  })
  // 与 createRoom 一致：先摆好 lobby，再让引擎初始化（有的引擎 create 只清数据不切阶段）
  room.phase = 'lobby'
  engine.create(room)
  touch(room)
  return null
}

/* ---------------------------- 视图构建 ---------------------------- */

function isRefereeViewer(room: Room, me: Player | null) {
  if (me && room.judgeMode === 'human' && room.refereeId === me.id) return true
  if (me?.isHost) return true
  return false
}

export function buildView(room: Room, token: string | null, asWatcher = false): RoomView | null {
  const meta = GAME_BY_ID[room.gameId]
  const engine = engineFor(room.gameId)
  if (!meta || !engine) return null

  const now = Date.now()
  const me = findPlayer(room, token)
  const spec = me ? null : findSpectator(room, token)
  const watching = !!me?.watching
  const role: RoomView['role'] = !me || watching
    ? 'watcher'
    : me.isHost
      ? 'host'
      : room.judgeMode === 'human' && room.refereeId === me.id
        ? 'referee'
        : 'player'

  const players = room.players
    .filter((p) => !p.watching)
    .map((p) => ({
      ...p,
      connected: now - p.lastSeen < PLAYER_OFFLINE_MS,
    }))

  const spectators = [
    ...room.players
      .filter((p) => p.watching)
      .map((p) => ({
        id: p.id,
        name: p.name,
        avatar: sanitizeAvatar(p.avatar, p.seat),
        connected: now - p.lastSeen < PLAYER_OFFLINE_MS,
        seat: p.seat as number | null,
      })),
    ...(room.spectators ?? []).map((s) => ({
      id: s.id,
      name: s.name,
      avatar: sanitizeAvatar(s.avatar, 1),
      connected: now - s.lastSeen < PLAYER_OFFLINE_MS,
      seat: null as number | null,
    })),
  ]

  const watchMe = watching
    ? { id: me!.id, name: me!.name, avatar: sanitizeAvatar(me!.avatar, me!.seat), seat: me!.seat as number | null }
    : spec
      ? { id: spec.id, name: spec.name, avatar: sanitizeAvatar(spec.avatar, 1), seat: null }
      : null

  // 房主只主持（或房主就是真人裁判）时按观众下发：不给玩家输入、不发私密词
  const spectatingHost =
    !!me?.isHost &&
    (room.hostPlays === false || (room.judgeMode === 'human' && room.refereeId === me.id))

  // 聊天头像按「现在」的头像解析：换头像后历史消息也跟着变，照片只存一份
  const chat = (room.chat ?? []).slice(-CHAT_VIEW).map((c) => {
    const author = room.players.find((p) => p.id === c.by)
    const s = author ? null : (room.spectators ?? []).find((x) => x.id === c.by)
    return {
      ...c,
      name: author?.name ?? s?.name ?? c.name,
      avatar: sanitizeAvatar(author?.avatar ?? s?.avatar ?? c.avatar, author?.seat ?? 1),
    }
  })

  const view: RoomView = {
    code: room.code,
    seq: room.seq,
    gameId: room.gameId,
    meta,
    phase: room.phase,
    round: room.round,
    turn: room.turn,
    deadlineAt: room.deadlineAt,
    serverNow: now,
    speakSeconds: room.speakSeconds ?? null,
    speakingId: room.speakingId ?? null,
    turnStartedAt: room.turnStartedAt ?? null,
    judgeMode: room.judgeMode,
    refereeId: room.refereeId,
    hostPlays: room.hostPlays,
    role,
    me: me && !watching ? players.find((p) => p.id === me.id) ?? null : null,
    players,
    spectators,
    watchMe,
    myToken: token,
    events: room.events.slice(-14),
    chat,
    finished: room.finished,
    publicData: engine.publicData(room),
    secret: me && !watching && !asWatcher && !spectatingHost ? engine.secretFor(room, me) : {},
    referee: !watching && isRefereeViewer(room, me) ? engine.refereeExtra(room) : null,
    needs: { prompt: null, input: 'none', inputHint: '', submitted: false, hostHint: '' },
  }

  view.needs = engine.needs(room, role === 'watcher' || spectatingHost ? null : me, view)
  return view
}

/* ---------------------------- 在线状态 ---------------------------- */

/** 超过 PRESENCE_WRITE_MS 才动 lastSeen，免得每次轮询都产生一次写 */
export function markSeen(room: Room, token: string | null, now = Date.now()) {
  if (!token) return
  const p = findPlayer(room, token)
  if (p) {
    if (now - p.lastSeen >= PRESENCE_WRITE_MS) p.lastSeen = now
    return
  }
  const s = findSpectator(room, token)
  if (s && now - s.lastSeen >= PRESENCE_WRITE_MS) s.lastSeen = now
}

/* ---------------------------- 心跳 ---------------------------- */

/** 常驻进程用：把所有房间推一格；Serverless 走请求里的 advance() */
export async function tickAll(now: number) {
  for (const room of (await store.all?.()) ?? []) {
    if (now - room.updatedAt > ROOM_TTL_MS) {
      await store.remove(room.code)
      continue
    }
    advance(room, now)
  }
}

export const roomCount = () => store.count()
