/**
 * 业务路由层：Express（本机局域网）和 Sites Edge Function（公网）共用这一份实现，
 * 只把「房间存哪儿」和「对外地址怎么算」留给各自的入口。
 */
import type { Profile } from '../src/shared/types'
import { GAME_BY_ID } from '../src/shared/games'
import {
  act,
  advance,
  buildView,
  checkDisband,
  cleanAvatarInput,
  configureRoom,
  createRoom,
  findPlayer,
  joinRoom,
  kickPlayer,
  loadRoom,
  markSeen,
  mutateRoom,
  nextStep,
  forceEnd,
  normalize,
  pickGame,
  removeRoom,
  resetToPicking,
  restartRoom,
  roomCount,
  sanitizeName,
  startRoom,
  watchJoin,
  type CreateInput,
} from './rooms'
import { postVoice, readVoice } from './voice'

export interface ApiResponse {
  status: number
  body: unknown
}

const ok = (body: unknown): ApiResponse => ({ status: 200, body })
const bad = (status: number, error: string): ApiResponse => ({ status, body: { error } })

/** origin 传 null 表示服务端算不出访客能打开的地址，让前端用自己的来源 */
export function metaBody(origin: string | null, lan?: string | null): ApiResponse {
  if (!origin) return ok({ base: null })
  const host = origin.split('//')[1]?.split(':')[0] ?? ''
  const isLocal = !host || host === 'localhost' || host.startsWith('127.') || host === '::1'
  return ok({ base: isLocal && lan ? lan : origin })
}

export async function health(): Promise<ApiResponse> {
  return ok({ ok: true, rooms: await roomCount() })
}

const clampProfile = (p: any): Profile => ({
  count: Math.max(2, Math.min(30, Math.round(p?.count ?? 6))),
  minutes: Math.max(3, Math.min(90, Math.round(p?.minutes ?? 10))),
  setting: ['seated', 'standing', 'lounging'].includes(p?.setting) ? p.setting : 'seated',
  vibes: Array.isArray(p?.vibes)
    ? p.vibes.filter((v: string) => ['laugh', 'warm', 'brain', 'rival'].includes(v)).slice(0, 4)
    : [],
  intimacy: ['strangers', 'colleagues', 'friends', 'family'].includes(p?.intimacy) ? p.intimacy : 'friends',
  shyLevel: [0, 1, 2].includes(p?.shyLevel) ? p.shyLevel : 1,
  propsOk: !!p?.propsOk,
  phonePerPerson: !!p?.phonePerPerson,
  wantMove: !!p?.wantMove,
})

export async function createRoomRoute(b: any): Promise<ApiResponse> {
  if (!b?.profile || typeof b.profile.count !== 'number' || !GAME_BY_ID[b.gameId]) {
    return bad(400, '缺少房间信息')
  }
  const input: CreateInput = {
    gameId: String(b.gameId),
    hostName: sanitizeName(b.hostName ?? ''),
    hostAvatar: cleanAvatarInput(b.hostAvatar),
    judgeMode: b.judgeMode === 'human' ? 'human' : 'ai',
    profile: clampProfile(b.profile),
    variant: typeof b.variant === 'string' ? b.variant.slice(0, 24) : undefined,
  }
  try {
    const { room, host } = await createRoom(input)
    return ok({ code: room.code, token: host.id, view: buildView(room, host.id) })
  } catch (e: any) {
    // 数据库故障不是「输入不对」，压成 400 会让线上只剩一个查不下去的错误
    if (typeof e?.status === 'number' && e.status >= 500) throw e
    return bad(400, '建房失败')
  }
}

export async function joinRoute(b: any): Promise<ApiResponse> {
  const code = normalize(b?.code)
  const avatar = cleanAvatarInput(b?.avatar)
  const result = await joinRoom(code, String(b?.name ?? ''), avatar)
  if (result) return ok({ code: result.room.code, token: result.player.id, view: buildView(result.room, result.player.id) })

  const loaded = await loadRoom(code)
  if (!loaded) return bad(404, '找不到这个房间，检查一下房间号')
  if (loaded.room.phase !== 'lobby') return bad(400, '这局已经开始了，可以点「观战进入」先看局势')
  const meta = GAME_BY_ID[loaded.room.gameId]
  if (meta && loaded.room.players.length >= meta.maxPlayers) {
    return bad(400, `这个房间满了（${meta.name} 最多 ${meta.maxPlayers} 人），可以先去观战席等空位`)
  }
  return bad(400, '名字不太对，换一个试试')
}

export async function watchJoinRoute(b: any): Promise<ApiResponse> {
  const code = normalize(b?.code)
  const result = await watchJoin(code, String(b?.name ?? ''), cleanAvatarInput(b?.avatar))
  if (result) {
    return ok({ code: result.room.code, token: result.spectator.id, view: buildView(result.room, result.spectator.id) })
  }
  const loaded = await loadRoom(code)
  if (!loaded) return bad(404, '找不到这个房间，检查一下房间号')
  return bad(400, '观战席满了或名字不太对，换一个试试')
}

export async function viewRoute(code: string, token: string | null, watch = false): Promise<ApiResponse> {
  const result = await mutateRoom(normalize(code), (room) => {
    if (token && room.kickedIds?.includes(token)) return { kicked: true as const }
    const now = Date.now()
    advance(room, now)
    markSeen(room, token, now)
    return { kicked: false as const, view: buildView(room, token, watch) }
  })
  if (!result.ok) return bad(404, result.reason === 'conflict' ? '房间太挤了，再刷一次' : '房间已解散或不存在')
  if (result.value.kicked) return bad(403, '你已被房主移出房间')
  return ok({ view: result.value.view })
}

export async function actionRoute(code: string, token: string, action: string, payload: any): Promise<ApiResponse> {
  const size = JSON.stringify(payload ?? {}).length
  // 照片头像走 action 上传，单独放宽到一张压缩图的体积
  const limit = action === 'avatar' ? 30_000 : 4000
  if (size > limit) return bad(400, '这段内容太长了')
  const result = await mutateRoom(normalize(code), (room) => {
    advance(room, Date.now())
    return act(room, token, action, payload)
  })
  if (!result.ok) return bad(404, result.reason === 'conflict' ? '这一步没写上，再点一次' : '房间已解散或不存在')
  return ok({ error: result.value, view: buildView(result.room, token) })
}

export async function nextRoute(code: string, token: string, force = false, finish = false): Promise<ApiResponse> {
  const result = await mutateRoom(normalize(code), (room) => {
    advance(room, Date.now())
    if (finish) return forceEnd(room, token || null)
    return force ? startRoom(room, token) : nextStep(room, token || null)
  })
  if (!result.ok) return bad(404, result.reason === 'conflict' ? '这一步没写上，再点一次' : '房间不存在或已结束')
  return ok({ error: result.value, view: buildView(result.room, token) })
}

export async function configureRoute(code: string, token: string, opts: any): Promise<ApiResponse> {
  const game =
    opts?.game && typeof opts.game === 'object' && !Array.isArray(opts.game)
      ? (opts.game as Record<string, unknown>)
      : undefined
  const result = await mutateRoom(normalize(code), (room) => {
    const host = findPlayer(room, token)
    if (!host?.isHost) return { denied: true as const, error: null }
    return { denied: false as const, error: configureRoom(room, { ...opts, hostToken: token, game }) }
  })
  if (!result.ok) return bad(404, result.reason === 'conflict' ? '这一步没写上，再点一次' : '房间已解散或不存在')
  if (result.value.denied) return bad(403, '只有房主能改房间设置')
  return ok({ error: result.value.error, view: buildView(result.room, token) })
}

export async function kickRoute(code: string, token: string, target: string): Promise<ApiResponse> {
  const result = await mutateRoom(normalize(code), (room) => kickPlayer(room, token, target))
  if (!result.ok) return bad(404, result.reason === 'conflict' ? '这一步没写上，再点一次' : '房间已解散或不存在')
  return ok({ error: result.value, view: buildView(result.room, token) })
}

export async function disbandRoute(code: string, token: string): Promise<ApiResponse> {
  const result = await mutateRoom(normalize(code), (room) => checkDisband(room, token))
  if (!result.ok) return bad(404, result.reason === 'conflict' ? '再点一次' : '房间已解散或不存在')
  if (result.value) return ok({ error: result.value })
  await removeRoom(code)
  return ok({ error: null })
}

export async function restartRoute(code: string, token: string): Promise<ApiResponse> {
  const result = await mutateRoom(normalize(code), (room) => {
    advance(room, Date.now())
    return restartRoom(room, token)
  })
  if (!result.ok) return bad(404, result.reason === 'conflict' ? '这一步没写上，再点一次' : '房间已解散或不存在')
  return ok({ error: result.value, view: buildView(result.room, token) })
}

/** 语音信令：GET 只读不写库，POST 走和其他动作一样的乐观锁 */
export async function voiceGetRoute(code: string, token: string | null, since: number): Promise<ApiResponse> {
  const loaded = await loadRoom(normalize(code))
  if (!loaded) return bad(404, '房间不存在或已结束')
  const r = readVoice(loaded.room, token ?? '', since)
  return typeof r === 'string' ? bad(403, r) : ok(r)
}

export async function voicePostRoute(code: string, token: string, payload: any): Promise<ApiResponse> {
  const result = await mutateRoom(normalize(code), (room) => postVoice(room, token, payload))
  if (!result.ok) return bad(404, result.reason === 'conflict' ? '语音信令没写上，再试一次' : '房间不存在或已结束')
  return ok({ error: result.value })
}

/** 结算页「再选游戏」：房主把房间切到选游戏阶段，所有端轮询后同步 */
export async function resetRoute(code: string, token: string): Promise<ApiResponse> {
  const result = await mutateRoom(normalize(code), (room) => {
    advance(room, Date.now())
    return resetToPicking(room, token)
  })
  if (!result.ok) return bad(404, result.reason === 'conflict' ? '这一步没写上，再点一次' : '房间不存在或已结束')
  return ok({ error: result.value, view: buildView(result.room, token) })
}

/** 选游戏阶段房主拍板下一局 */
export async function pickRoute(code: string, token: string, gameId: string): Promise<ApiResponse> {
  const result = await mutateRoom(normalize(code), (room) => pickGame(room, token, gameId))
  if (!result.ok) return bad(404, result.reason === 'conflict' ? '这一步没写上，再点一次' : '房间不存在或已结束')
  return ok({ error: result.value, view: buildView(result.room, token) })
}
