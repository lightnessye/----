/**
 * 语音信令信箱：开麦玩家把 WebRTC 的 offer/answer/ICE 候选寄存在房间里，
 * 对方轮询取走。只服务连接建立，所以快进快出、过期即弃，不进游戏引擎。
 */
import type { Room } from '../src/shared/types'
import {
  VOICE_KEEP,
  VOICE_MAX_BATCH,
  VOICE_MAX_DATA,
  VOICE_TTL_MS,
  type VoiceSignal,
  type VoiceSignalKind,
} from '../src/shared/voice'
import { touch } from './rooms'

const KINDS: VoiceSignalKind[] = ['offer', 'answer', 'ice']

/** 返回错误文案或 null；校验全部通过才落信箱，避免半批写入 */
export function postVoice(room: Room, token: string, payload: any): string | null {
  const actor = room.players.find((p) => p.id === token)
  if (!actor) return '身份失效，请重新加入房间'
  if (!actor.micOn) return '先开麦再连接语音'
  const list = Array.isArray(payload?.signals) ? payload.signals.slice(0, VOICE_MAX_BATCH) : []
  if (!list.length) return null

  const checked: { to: string; kind: VoiceSignalKind; data: Record<string, unknown> }[] = []
  for (const s of list) {
    if (!KINDS.includes(s?.kind)) return '不认识的语音信令'
    const to = String(s?.to ?? '')
    if (to === token || !room.players.some((p) => p.id === to)) return '语音信令发给了不在房间里的人'
    const data = s?.data
    if (!data || typeof data !== 'object' || Array.isArray(data)) return '语音信令格式不对'
    if (JSON.stringify(data).length > VOICE_MAX_DATA) return '语音信令太大了'
    checked.push({ to, kind: s.kind, data })
  }

  const now = Date.now()
  const box = room.voice ?? (room.voice = [])
  for (const s of checked) {
    room.voiceSeq = (room.voiceSeq ?? 0) + 1
    box.push({ id: room.voiceSeq, from: token, to: s.to, kind: s.kind, data: s.data, at: now })
  }
  const cutoff = now - VOICE_TTL_MS
  while (box.length && (box.length > VOICE_KEEP || box[0].at < cutoff)) box.shift()
  touch(room)
  return null
}

/** 只读，不写库：取寄给我的、比 since 新的、没过期的信令 */
export function readVoice(
  room: Room,
  token: string,
  since: number,
): { signals: VoiceSignal[]; serverNow: number } | string {
  if (!room.players.some((p) => p.id === token)) return '身份失效，请重新加入房间'
  const now = Date.now()
  const signals = (room.voice ?? []).filter(
    (s) => s.to === token && s.id > since && now - s.at < VOICE_TTL_MS,
  )
  return { signals, serverNow: now }
}