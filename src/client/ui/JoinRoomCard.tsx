import { useRef, useState } from 'react'
import { joinRoom } from '../api'
import { go, saveToken } from '../route'
import { ROOM_CODE_LENGTH } from '../../shared/types'
import { sanitizeAvatar } from '../../shared/avatars'
import { AvatarPicker } from './Avatar'

/** 首页的内联加入入口：朋友开好了局，填房间号和名字直接进场，不用再跳一页 */
export function JoinRoomCard() {
  const [code, setCode] = useState('')
  const [name, setName] = useState(() => localStorage.getItem('icebreaker.name') ?? '')
  const [avatar, setAvatar] = useState(() => sanitizeAvatar(localStorage.getItem('icebreaker.avatar')))
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const nameRef = useRef<HTMLInputElement>(null)

  const typeCode = (raw: string) => {
    const v = raw
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '')
      .slice(0, ROOM_CODE_LENGTH)
    setCode(v)
    setErr(null)
    if (v.length === ROOM_CODE_LENGTH) nameRef.current?.focus()
  }

  const submit = async () => {
    if (busy) return
    if (code.length !== ROOM_CODE_LENGTH)
      return setErr(`房间号是 ${ROOM_CODE_LENGTH} 位，看看大屏上的方块数字`)
    if (!name.trim()) {
      nameRef.current?.focus()
      return setErr('起个名字，大家才知道谁是谁')
    }
    setBusy(true)
    setErr(null)
    try {
      const res = await joinRoom(code, name.trim(), avatar)
      localStorage.setItem('icebreaker.name', name.trim())
      saveToken(res.code, res.token)
      go(`/p.html?c=${res.code}`)
    } catch (e: any) {
      setErr(e?.message ?? '进不去这个房间')
      setBusy(false)
    }
  }

  return (
    <section className="home-join" aria-label="加入房间">
      <div className="home-join-head">
        <span className="home-join-badge" aria-hidden="true">
          <EnterIcon />
        </span>
        <div>
          <b>加入房间</b>
          <span>朋友开好了局？填大屏上的 {ROOM_CODE_LENGTH} 位房间号</span>
        </div>
      </div>

      <input
        className="field code home-join-code"
        value={code}
        inputMode="text"
        autoCapitalize="characters"
        autoComplete="off"
        spellCheck={false}
        maxLength={ROOM_CODE_LENGTH}
        placeholder={'—'.repeat(ROOM_CODE_LENGTH)}
        aria-label="房间号"
        onChange={(e) => typeCode(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            if (code.length === ROOM_CODE_LENGTH) nameRef.current?.focus()
            else void submit()
          }
        }}
      />

      <div className="home-join-row">
        <input
          ref={nameRef}
          className="field"
          value={name}
          maxLength={12}
          placeholder="你的名字"
          aria-label="你的名字"
          onChange={(e) => {
            setName(e.target.value)
            setErr(null)
          }}
          onKeyDown={(e) => e.key === 'Enter' && void submit()}
        />
        <button type="button" className="btn primary" disabled={busy} onClick={() => void submit()}>
          {busy ? <span className="spin" /> : '进场 →'}
        </button>
      </div>

      <label className="blk" style={{ marginTop: 12 }}>
        选个头像
      </label>
      <AvatarPicker
        compact
        value={avatar}
        onChange={(id) => {
          setAvatar(id)
          localStorage.setItem('icebreaker.avatar', id)
        }}
      />

      {err && (
        <div className="banner err home-join-err" role="alert">
          {err}
        </div>
      )}
    </section>
  )
}

function EnterIcon() {
  return (
    <svg viewBox="0 0 16 16" width="17" height="17" fill="none" aria-hidden="true">
      <path
        d="M9.5 2.5h3a1 1 0 011 1v9a1 1 0 01-1 1h-3"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <path
        d="M2 8h6.5M6 5.5L8.5 8 6 10.5"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}