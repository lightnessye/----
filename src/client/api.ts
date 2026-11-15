import type { Profile, RoomView } from '../shared/types'
import type { VoiceSignal, VoiceSignalKind } from '../shared/voice'

/** 本机和 Sites 共用这一个前缀，本地 Express 也挂了同一套路由，产物不再分两种 */
const API = '/functions/v1/app'

export const LS = {
  token: 'icebreaker.token',
  code: 'icebreaker.code',
  profile: 'icebreaker.profile',
}

async function req<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(API + url, {
    headers: { 'content-type': 'application/json' },
    ...init,
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body.error ?? `请求失败（${res.status}）`)
  return body as T
}

export interface CreatedRoom {
  code: string
  token: string
  view: RoomView
}

export function createRoom(input: {
  gameId: string
  hostName: string
  hostAvatar?: string
  judgeMode: 'ai' | 'human'
  profile: Profile
  variant?: string
}) {
  return req<CreatedRoom>('/api/rooms', { method: 'POST', body: JSON.stringify(input) })
}

export function joinRoom(code: string, name: string, avatar?: string) {
  return req<CreatedRoom>('/api/join', { method: 'POST', body: JSON.stringify({ code, name, avatar }) })
}

export function fetchView(code: string, token: string | null, watch = false) {
  const q = new URLSearchParams()
  if (token) q.set('token', token)
  if (watch) q.set('watch', '1')
  return req<{ view: RoomView }>(`/api/rooms/${encodeURIComponent(code)}?${q}`).then((r) => r.view)
}

export function sendAction(code: string, token: string, action: string, payload: unknown) {
  return req<{ error: string | null; view: RoomView }>(`/api/rooms/${encodeURIComponent(code)}/action`, {
    method: 'POST',
    body: JSON.stringify({ token, action, payload }),
  }).then((r) => r.view)
}

export function sendNext(code: string, token: string) {
  return req<{ error: string | null; view: RoomView }>(`/api/rooms/${encodeURIComponent(code)}/next`, {
    method: 'POST',
    body: JSON.stringify({ token }),
  })
}

export function configure(
  code: string,
  token: string,
  opts: { judgeMode?: 'ai' | 'human'; refereeId?: string | null; variant?: string; speakSeconds?: number | null; game?: Record<string, unknown> },
) {
  return req<{ error: string | null; view: RoomView }>(`/api/rooms/${encodeURIComponent(code)}/configure`, {
    method: 'POST',
    body: JSON.stringify({ token, ...opts }),
  })
}

/** 别人真的能打开的地址来源；问不到就退回当前来源 */
export async function fetchShareBase(): Promise<string | null> {
  try {
    const { base } = await req<{ base: string }>('/api/meta')
    return /^https?:\/\/[^/]+$/.test(base) ? base : null
  } catch {
    return null
  }
}

export interface VoiceOutSignal {
  to: string
  kind: VoiceSignalKind
  data: unknown
}

export function fetchVoice(code: string, token: string, since: number) {
  const q = new URLSearchParams({ token, since: String(since) })
  return req<{ signals: VoiceSignal[]; serverNow: number }>(
    `/api/rooms/${encodeURIComponent(code)}/voice?${q}`,
  )
}

export function postVoice(code: string, token: string, signals: VoiceOutSignal[]) {
  return req<{ error: string | null }>(`/api/rooms/${encodeURIComponent(code)}/voice`, {
    method: 'POST',
    body: JSON.stringify({ token, signals }),
  })
}

/** 关页面/跳走时尽力闭麦， beacon 不保证送达，送不到也有离线兜底 */
export function beaconMicOff(code: string, token: string) {
  try {
    const body = new Blob([JSON.stringify({ token, action: 'mic', payload: { on: false } })], {
      type: 'application/json',
    })
    navigator.sendBeacon(`${API}/api/rooms/${encodeURIComponent(code)}/action`, body)
  } catch {
    /* 忽略 */
  }
}
