import { useEffect, useRef, useState } from 'react'
import type { RoomView } from '../../shared/types'
import { AvatarBadge } from './Avatar'

const hhmm = (at: number) => {
  const d = new Date(at)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

/** 房间聊天：玩家和具名观战者可发言，匿名围观页只读。可折叠，折叠时提示新消息数。 */
export function ChatPanel({
  view,
  onSend,
  height = 280,
  defaultOpen = true,
}: {
  view: RoomView
  onSend?: (text: string) => Promise<string | null>
  height?: number
  defaultOpen?: boolean
}) {
  const messages = view.chat ?? []
  const myId = view.me?.id ?? view.watchMe?.id ?? null
  const canSend = !!onSend && !!myId
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [away, setAway] = useState(false)
  const [open, setOpen] = useState(defaultOpen)
  const [seenId, setSeenId] = useState(() => (messages.length ? messages[messages.length - 1].id : 0))
  const scrollRef = useRef<HTMLDivElement>(null)
  const stick = useRef(true)

  const lastId = messages.length ? messages[messages.length - 1].id : 0
  const unread = open ? 0 : messages.filter((m) => m.id > seenId && m.by !== myId).length
  useEffect(() => {
    if (!open) return
    setSeenId(lastId)
    const el = scrollRef.current
    if (!el) return
    if (stick.current) el.scrollTop = el.scrollHeight
    else setAway(true)
  }, [lastId, open])

  const onScroll = () => {
    const el = scrollRef.current
    if (!el) return
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 48
    stick.current = nearBottom
    if (nearBottom) setAway(false)
  }

  const jumpDown = () => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
    stick.current = true
    setAway(false)
  }

  const send = async () => {
    const t = text.trim()
    if (!t || busy || !onSend) return
    setBusy(true)
    setErr(null)
    stick.current = true
    const e = await onSend(t)
    setBusy(false)
    if (e) setErr(e)
    else setText('')
  }

  return (
    <div className="panel chat-panel">
      <button type="button" className="chat-head chat-toggle" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <div className="h" style={{ marginBottom: 0 }}>💬 房间聊天</div>
        {unread > 0 && <span className="chip hot chat-unread">{unread} 条新消息</span>}
        <span className="chip chat-count">{messages.length} 条</span>
        {!canSend && <span className="dim chat-readonly">只看</span>}
        <span className="chat-caret">{open ? '▾' : '▸'}</span>
      </button>

      {open && (
      <>
      <div className="chat-scroll-wrap">
        <div className="chat-scroll" style={{ maxHeight: height }} ref={scrollRef} onScroll={onScroll}>
          {messages.length === 0 ? (
            <p className="chat-empty">
              还没有人说话。
              <br />
              发一句，打破沉默。
            </p>
          ) : (
            messages.map((m) => {
              const mine = !!myId && m.by === myId
              return (
                <div key={m.id} className={`chat-msg${mine ? ' mine' : ''}`}>
                  <AvatarBadge id={m.avatar} size={30} />
                  <div className="chat-body">
                    <div className="chat-meta">
                      <b>{mine ? '我' : m.name}</b>
                      <span>{hhmm(m.at)}</span>
                    </div>
                    <div className="chat-bubble">{m.text}</div>
                  </div>
                </div>
              )
            })
          )}
        </div>
        {away && (
          <button type="button" className="chat-jump" onClick={jumpDown}>
            ↓ 新消息
          </button>
        )}
      </div>

      {canSend && (
        <>
          <div className="chat-input-row">
            <input
              className="field"
              value={text}
              maxLength={200}
              placeholder="说点什么，房间里所有人都看得到"
              aria-label="聊天输入框"
              onChange={(e) => {
                setText(e.target.value)
                setErr(null)
              }}
              onKeyDown={(e) => e.key === 'Enter' && void send()}
            />
            <button
              type="button"
              className="chat-send"
              disabled={busy || !text.trim()}
              aria-label="发送"
              onClick={() => void send()}
            >
              {busy ? <span className="spin" /> : <SendIcon />}
            </button>
          </div>
          <div className="chat-foot">
            {err ? (
              <span className="chat-err" role="alert">{err}</span>
            ) : (
              <span className="dim">回车发送 · 房间里所有人可见</span>
            )}
            {text.length > 150 && <span className="dim mono">{text.length}/200</span>}
          </div>
        </>
      )}
      </>
      )}
    </div>
  )
}

function SendIcon() {
  return (
    <svg viewBox="0 0 20 20" width="18" height="18" fill="none" aria-hidden="true">
      <path
        d="M3.3 10.2L16.4 3.7c.6-.3 1.2.3.9.9l-6.5 13.1c-.3.6-1.2.5-1.4-.1l-1.3-4.6a1 1 0 00-.7-.7l-4.6-1.3c-.6-.2-.7-1.1-.1-1.4z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path d="M8.2 11.8l3.4-3.4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  )
}