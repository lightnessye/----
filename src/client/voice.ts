/**
 * 语音开麦：开麦的玩家之间两两建立 WebRTC 连接（mesh），音频 P2P 直连。
 * 信令走房间信箱（1s 轮询），所以连接建立有几秒延迟，建立后音频是实时的。
 * 发起方规则：玩家 id 字典序小的一方发起 offer，避免两边同时 offer 撞车。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { beaconMicOff, fetchVoice, postVoice, type VoiceOutSignal } from './api'
import type { Player, RoomView } from '../shared/types'
import { VOICE_MAX_BATCH, type VoiceSignal } from '../shared/voice'

/** 国内网络 Google STUN 常被墙，QQ 的优先；同一局域网下不靠 STUN 也能直连 */
const ICE_SERVERS: RTCIceServer[] = [
  { urls: ['stun:stun.qq.com:3478', 'stun:stun.l.google.com:19302'] },
]
const POLL_MS = 1000
const ICE_FLUSH_MS = 300
/** 连接卡这么久还没通就拆掉重建（信令丢包自愈） */
const STUCK_MS = 12_000
/** 超过这个年纪的信令直接丢弃（刷新后 lastId 归零会读到旧信令） */
const SIGNAL_MAX_AGE_MS = 30_000

export type PeerState = 'connecting' | 'connected' | 'failed'

interface Peer {
  pc: RTCPeerConnection
  audio: HTMLAudioElement | null
  /** remoteDescription 还没设好时先到的 ICE 候选 */
  iceBuf: RTCIceCandidateInit[]
  createdAt: number
  initiator: boolean
}

class Mesh {
  private pcs = new Map<string, Peer>()
  /** offer 还没到就先到的 ICE，按发件人缓冲 */
  private orphanIce = new Map<string, RTCIceCandidateInit[]>()
  private stream: MediaStream | null = null
  private outbox: VoiceOutSignal[] = []
  private flushTimer: number | null = null
  private pollTimer: number | null = null
  private flushing = false
  private polling = false
  private lastId = 0
  private stopped = false

  onStates: (s: Record<string, PeerState>) => void = () => {}
  onTapNeeded: () => void = () => {}

  constructor(
    private code: string,
    private token: string,
  ) {}

  start(stream: MediaStream) {
    this.stream = stream
    this.flushTimer = window.setInterval(() => void this.flush(), ICE_FLUSH_MS)
    this.pollTimer = window.setInterval(() => void this.poll(), POLL_MS)
    void this.poll()
  }

  stop() {
    this.stopped = true
    if (this.flushTimer !== null) window.clearInterval(this.flushTimer)
    if (this.pollTimer !== null) window.clearInterval(this.pollTimer)
    for (const id of [...this.pcs.keys()]) this.drop(id)
    this.stream?.getTracks().forEach((t) => t.stop())
    this.stream = null
    this.outbox = []
    this.orphanIce.clear()
    this.onStates({})
  }

  /** 每次房间视图轮询都跑：补上缺的连接，拆掉多余/卡死的连接 */
  reconcile(players: Player[]) {
    if (!this.stream || this.stopped) return
    const want = new Set(
      players.filter((p) => p.micOn && p.connected && p.id !== this.token).map((p) => p.id),
    )
    for (const [id, peer] of this.pcs) {
      const stuck =
        peer.initiator &&
        peer.pc.connectionState !== 'connected' &&
        Date.now() - peer.createdAt > STUCK_MS
      if (!want.has(id) || stuck || peer.pc.connectionState === 'failed') this.drop(id)
    }
    for (const id of want) {
      if (!this.pcs.has(id) && this.token < id) this.offerTo(id)
    }
  }

  tapListen() {
    for (const peer of this.pcs.values()) {
      peer.audio?.play().catch(() => this.onTapNeeded())
    }
  }

  private emitStates() {
    const s: Record<string, PeerState> = {}
    for (const [id, peer] of this.pcs) {
      const c = peer.pc.connectionState
      s[id] = c === 'connected' ? 'connected' : c === 'failed' ? 'failed' : 'connecting'
    }
    this.onStates(s)
  }

  private drop(id: string) {
    const peer = this.pcs.get(id)
    if (!peer) return
    this.pcs.delete(id)
    peer.pc.onicecandidate = null
    peer.pc.ontrack = null
    peer.pc.onconnectionstatechange = null
    peer.pc.close()
    if (peer.audio) {
      peer.audio.pause()
      peer.audio.srcObject = null
      peer.audio.remove()
    }
    this.emitStates()
  }

  private ensurePeer(id: string, initiator: boolean): Peer {
    const existing = this.pcs.get(id)
    if (existing) return existing
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS })
    const peer: Peer = { pc, audio: null, iceBuf: [], createdAt: Date.now(), initiator }
    this.pcs.set(id, peer)
    for (const track of this.stream!.getTracks()) pc.addTrack(track, this.stream!)
    const orphan = this.orphanIce.get(id)
    if (orphan) {
      peer.iceBuf.push(...orphan)
      this.orphanIce.delete(id)
    }
    pc.onicecandidate = (e) => {
      if (e.candidate) this.queueIce(id, e.candidate.toJSON())
    }
    pc.ontrack = (e) => this.attach(id, e.streams[0] ?? new MediaStream([e.track]))
    pc.onconnectionstatechange = () => {
      this.emitStates()
      if (pc.connectionState === 'failed') this.drop(id)
    }
    this.emitStates()
    return peer
  }

  private offerTo(id: string) {
    const peer = this.ensurePeer(id, true)
    void peer.pc
      .createOffer()
      .then((offer) => peer.pc.setLocalDescription(offer))
      .then(() => {
        const d = peer.pc.localDescription
        if (d) this.send([{ to: id, kind: 'offer', data: { type: d.type, sdp: d.sdp } }])
      })
      .catch(() => this.drop(id))
  }

  private attach(id: string, stream: MediaStream) {
    const peer = this.pcs.get(id)
    if (!peer || this.stopped) return
    if (!peer.audio) {
      const el = document.createElement('audio')
      el.autoplay = true
      el.style.display = 'none'
      document.body.appendChild(el)
      peer.audio = el
    }
    peer.audio.srcObject = stream
    peer.audio.play().catch(() => this.onTapNeeded())
  }

  /* ---------------------------- 信令发送 ---------------------------- */

  private queueIce(id: string, c: RTCIceCandidateInit) {
    const found = this.outbox.find((s) => s.to === id && s.kind === 'ice')
    if (found) (found.data as { candidates: RTCIceCandidateInit[] }).candidates.push(c)
    else this.outbox.push({ to: id, kind: 'ice', data: { candidates: [c] } })
  }

  private send(signals: VoiceOutSignal[]) {
    this.outbox.push(...signals)
    void this.flush()
  }

  private async flush() {
    if (this.flushing || this.stopped || !this.outbox.length) return
    this.flushing = true
    const batch = this.outbox.splice(0, VOICE_MAX_BATCH)
    try {
      await postVoice(this.code, this.token, batch)
    } catch {
      // 乐观锁撞车或服务端抖动：重试一次，再失败就丢，卡死的连接由 reconcile 重建
      try {
        await postVoice(this.code, this.token, batch)
      } catch {
        /* 丢弃 */
      }
    }
    this.flushing = false
  }

  /* ---------------------------- 信令接收 ---------------------------- */

  private async poll() {
    if (this.polling || this.stopped) return
    this.polling = true
    try {
      const r = await fetchVoice(this.code, this.token, this.lastId)
      for (const s of r.signals) {
        this.lastId = Math.max(this.lastId, s.id)
        if (this.stopped) break
        if (Date.now() - s.at > SIGNAL_MAX_AGE_MS) continue
        await this.handle(s).catch(() => {})
      }
    } catch {
      /* 轮询失败下一轮再来 */
    }
    this.polling = false
  }

  private async handle(s: VoiceSignal) {
    if (s.kind === 'ice') {
      const cs = (s.data as { candidates?: RTCIceCandidateInit[] })?.candidates
      if (!Array.isArray(cs)) return
      const peer = this.pcs.get(s.from)
      for (const c of cs) {
        if (!c || typeof c !== 'object') continue
        if (peer?.pc.remoteDescription) await peer.pc.addIceCandidate(c).catch(() => {})
        else if (peer) peer.iceBuf.push(c)
        else {
          const buf = this.orphanIce.get(s.from) ?? []
          if (buf.length < 50) buf.push(c)
          this.orphanIce.set(s.from, buf)
        }
      }
      return
    }

    if (s.kind === 'offer') {
      const existing = this.pcs.get(s.from)
      // 同一账号在另一个页面也开了麦：保住先连上的，后来的offer忽略
      if (existing?.pc.connectionState === 'connected') return
      if (existing) this.drop(s.from)
      const peer = this.ensurePeer(s.from, false)
      await peer.pc.setRemoteDescription(s.data as unknown as RTCSessionDescriptionInit)
      await this.flushIceBuf(peer)
      const answer = await peer.pc.createAnswer()
      await peer.pc.setLocalDescription(answer)
      const d = peer.pc.localDescription
      if (d) this.send([{ to: s.from, kind: 'answer', data: { type: d.type, sdp: d.sdp } }])
      return
    }

    if (s.kind === 'answer') {
      const peer = this.pcs.get(s.from)
      if (!peer || peer.pc.signalingState !== 'have-local-offer') return
      await peer.pc.setRemoteDescription(s.data as unknown as RTCSessionDescriptionInit)
      await this.flushIceBuf(peer)
    }
  }

  private async flushIceBuf(peer: Peer) {
    const buf = peer.iceBuf.splice(0)
    for (const c of buf) await peer.pc.addIceCandidate(c).catch(() => {})
  }
}

/* ------------------------------------------------------------------ */

export interface VoiceState {
  /** 环境能不能开麦（HTTPS / localhost + 有 getUserMedia） */
  supported: boolean
  /** 服务端广播的本人麦态 */
  micOn: boolean
  /** 本页面是否正握着麦克风（另一页面开着麦时为 false） */
  localActive: boolean
  starting: boolean
  error: string | null
  /** 浏览器拦了自动播放，需要用户点一下才能收听 */
  needsTap: boolean
  peers: { id: string; name: string; state: PeerState }[]
  toggle: () => void
  /** 麦在别的页面开着时，把它抢到本页面 */
  takeOver: () => void
  tapListen: () => void
}

export function useVoice(
  view: RoomView | null,
  run: (action: string, payload?: unknown) => Promise<string | null>,
): VoiceState {
  const code = view?.code ?? null
  const token = view?.me?.id ?? null
  const micOn = !!view?.me?.micOn
  const supported =
    typeof navigator !== 'undefined' &&
    !!navigator.mediaDevices?.getUserMedia &&
    typeof RTCPeerConnection !== 'undefined'

  const [starting, setStarting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [needsTap, setNeedsTap] = useState(false)
  const [states, setStates] = useState<Record<string, PeerState>>({})
  const [localActive, setLocalActive] = useState(false)

  const meshRef = useRef<Mesh | null>(null)
  const startingRef = useRef(false)
  /** 用户意图：false 时即使服务端说麦开着也不自动接管（刚手动闭麦） */
  const wantRef = useRef<boolean | null>(null)
  const runRef = useRef(run)
  runRef.current = run
  const micOnRef = useRef(micOn)
  micOnRef.current = micOn
  const bcRef = useRef<BroadcastChannel | null>(null)

  const stop = useCallback(() => {
    meshRef.current?.stop()
    meshRef.current = null
    setLocalActive(false)
    setNeedsTap(false)
    setStates({})
  }, [])

  const start = useCallback(async () => {
    if (!code || !token || startingRef.current || meshRef.current) return
    startingRef.current = true
    setStarting(true)
    setError(null)
    let stream: MediaStream | null = null
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      })
      const err = await runRef.current('mic', { on: true })
      if (err) {
        stream.getTracks().forEach((t) => t.stop())
        setError(err)
        wantRef.current = false
        return
      }
      const mesh = new Mesh(code, token)
      mesh.onStates = setStates
      mesh.onTapNeeded = () => setNeedsTap(true)
      mesh.start(stream)
      meshRef.current = mesh
      setLocalActive(true)
      // 同一账号别的页面正在开麦：通知它交出麦克风
      bcRef.current?.postMessage('taken')
    } catch (e: any) {
      stream?.getTracks().forEach((t) => t.stop())
      setError(
        e?.name === 'NotAllowedError'
          ? '麦克风权限被拒绝了，在浏览器地址栏允许后再试'
          : e?.name === 'NotFoundError'
            ? '没找到麦克风设备'
            : `开麦失败：${e?.message ?? '未知错误'}`,
      )
      wantRef.current = false
    } finally {
      startingRef.current = false
      setStarting(false)
    }
  }, [code, token])

  const toggle = useCallback(() => {
    if (micOnRef.current) {
      wantRef.current = false
      stop()
      void runRef.current('mic', { on: false })
    } else {
      wantRef.current = true
      void start()
    }
  }, [start, stop])

  const tapListen = useCallback(() => {
    setNeedsTap(false)
    meshRef.current?.tapListen()
  }, [])

  const takeOver = useCallback(() => {
    wantRef.current = true
    void start()
  }, [start])

  // 同一账号多页面：后开的页面接管麦克风，先开的交出（服务端麦态不变）
  useEffect(() => {
    if (!code || !token || typeof BroadcastChannel === 'undefined') return
    const bc = new BroadcastChannel(`icebreaker-voice-${code}-${token}`)
    bcRef.current = bc
    bc.onmessage = (e) => {
      if (e.data === 'taken' && meshRef.current) {
        wantRef.current = false
        stop()
      }
    }
    return () => {
      bc.close()
      bcRef.current = null
    }
  }, [code, token, stop])

  // 跟着每次房间轮询走：对齐麦态 + 补齐/拆掉连接
  const players = view?.players
  useEffect(() => {
    if (!micOn && meshRef.current) stop()
    if (micOn && !meshRef.current && supported && wantRef.current !== false) void start()
    meshRef.current?.reconcile(players ?? [])
  }, [players, micOn, supported, start, stop])

  // 关页面/跳走时尽力闭麦；送不到也有 45s 离线兜底
  useEffect(() => {
    if (!code || !token) return
    const off = () => {
      if (micOnRef.current) beaconMicOff(code, token)
    }
    window.addEventListener('pagehide', off)
    return () => {
      window.removeEventListener('pagehide', off)
      off()
      stop()
    }
  }, [code, token, stop])

  const peers = (view?.players ?? [])
    .filter((p) => p.micOn && p.id !== token)
    .map((p) => ({ id: p.id, name: p.name, state: states[p.id] ?? ('connecting' as PeerState) }))

  return { supported, micOn, localActive, starting, error, needsTap, peers, toggle, takeOver, tapListen }
}