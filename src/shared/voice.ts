/**
 * 语音开麦的 WebRTC 信令契约。语音流本身走 P2P，不过服务器；
 * 服务器只随房间存转这个信箱（本机内存 / Sites 数据库都兼容）。
 */
export type VoiceSignalKind = 'offer' | 'answer' | 'ice'

export interface VoiceSignal {
  /** 房间内单调递增，接收方拿它做 since 游标 */
  id: number
  from: string
  to: string
  kind: VoiceSignalKind
  /** offer/answer: {type, sdp}；ice: {candidates: [...]} */
  data: Record<string, unknown>
  at: number
}

/** 一次 POST 最多带几条信令（body 上限 48kb，留出余量） */
export const VOICE_MAX_BATCH = 6
export const VOICE_MAX_DATA = 6000
/** 信令只服务连接建立，过期即弃 */
export const VOICE_TTL_MS = 60_000
export const VOICE_KEEP = 120