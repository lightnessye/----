import { useEffect, useState } from 'react'
import { useRoom } from '../hooks/useRoom'
import { uiFor } from '../games'
import { AvatarBadge } from '../ui/Avatar'
import { ChatPanel } from '../ui/ChatPanel'
import { PlayerGrid } from '../ui/PlayerGrid'
import { SpectatorBar } from '../ui/SpectatorBar'
import { RulesModal } from '../ui/RulesModal'
import { StageView } from '../ui/StageView'
import { Ticker, Timer } from '../ui/common'
import { forgetRoom, go, joinHref } from '../route'
import type { RoomView } from '../../shared/types'

/** 具名观战页：看公开局势（不是上帝视角），能聊天，大厅里可加入、局中可接替空位 */
export function Watch({ code, token }: { code: string; token: string }) {
  const socket = useRoom(code, token)
  const { view, error } = socket

  // 加入 / 接替 / 回归成功后身份变成玩家，直接送去手机玩家页
  useEffect(() => {
    if (view?.me && location.pathname.replace(/\.html$/, '').endsWith('/watch')) {
      go(`/p.html?c=${code}`, true)
    }
  }, [view?.me, code])

  if (error && !view) {
    const gone = error.includes('移出房间') || error.includes('解散')
    return (
      <div className="app">
        <div className="wrap center-v center" style={{ minHeight: '80vh' }}>
          <h2>{error}</h2>
          <p className="sub">{gone ? '这个身份已经失效了。' : '网络抖了一下，再试一次。'}</p>
          <div className="row" style={{ gap: 10 }}>
            {gone ? (
              <button
                className="btn primary big"
                onClick={() => {
                  forgetRoom(code)
                  go('/')
                }}
              >
                回首页
              </button>
            ) : (
              <a className="btn primary big" href={joinHref(code)}>
                回加入页
              </a>
            )}
          </div>
        </div>
      </div>
    )
  }

  if (!view) {
    return (
      <div className="app">
        <div className="wrap center-v center" style={{ minHeight: '80vh' }}>
          <span className="spin" />
        </div>
      </div>
    )
  }

  return <WatchBody {...socket} view={view} />
}

/** 观战主体。玩家退到观战席时，Phone 也直接复用它，不再另开一条轮询 */
export function WatchBody({
  view,
  run,
  now,
  secondsLeft,
  offline,
}: {
  view: RoomView
  run: (action: string, payload?: unknown) => Promise<string | null>
  now: number
  secondsLeft: number | null
  offline: boolean
}) {
  const [rules, setRules] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const ui = uiFor(view)
  const model = ui.stage(view)
  const turnId = ui.turnId?.(view) ?? null
  const isLobby = view.phase === 'lobby'
  const isOver = view.phase === 'over'
  const vacancies = (view.spectators ?? []).filter((s) => s.seat != null)
  const mySeat = view.watchMe?.seat ?? null

  const act = async (action: string, payload?: unknown) => {
    setBusy(true)
    setErr(null)
    const e = await run(action, payload)
    setErr(e)
    setBusy(false)
  }

  return (
    <div className="app">
      <div className="wrap">
        <div className="phone-head">
          <AvatarBadge id={view.watchMe?.avatar} size={42} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 800 }}>
              {view.meta.emoji} {view.meta.name}
            </div>
            <div className="dim">
              房间 {view.code} · {view.watchMe?.name ?? '观战者'} · 👀 观战中
            </div>
          </div>
          <div className="row" style={{ gap: 6 }}>
            <button type="button" className="btn tiny" onClick={() => setRules(true)}>
              📖 规则
            </button>
            {offline && <span className="chip" style={{ color: 'var(--bad)' }}>重连中</span>}
          </div>
        </div>

        <SpectatorBar
          view={view}
          onTakeover={
            !isLobby && !isOver && vacancies.length
              ? (id) => void act('takeover', { target: id })
              : undefined
          }
        />

        <div className="panel" style={{ marginTop: 14 }}>
          <div className="h">场上玩家</div>
          <PlayerGrid view={view} turnId={turnId} />
        </div>

        {mySeat != null ? (
          <div className="card tight" style={{ marginTop: 14 }}>
            <div className="row between" style={{ gap: 10, flexWrap: 'wrap' }}>
              <span style={{ fontWeight: 700 }}>你的 {mySeat} 号位还留着</span>
              {!isOver && (
                <button className="btn primary" disabled={busy} onClick={() => void act('rejoin')}>
                  回到我的座位
                </button>
              )}
            </div>
            <p className="notice" style={{ margin: '8px 0 0' }}>
              {isOver
                ? '这局结束了，等房主返回大厅后再归队。'
                : '别人也可能接替这个位置；想继续玩就早点回来。'}
            </p>
          </div>
        ) : isLobby ? (
          <div className="card accent" style={{ marginTop: 14 }}>
            <h2>等房主开局</h2>
            <p className="sub">你在观战席，能看到大家准备的情况。想一起玩就点下面。</p>
            <button
              className="btn primary big"
              disabled={busy}
              onClick={() => void act('joinplay')}
            >
              🎮 加入对局
            </button>
          </div>
        ) : null}

        {!isLobby && (
          <div className="panel" style={{ marginTop: 14 }}>
            <div className="h">当前局势 · 公开视角</div>
            <StageView model={model} />
            {secondsLeft !== null && !isOver && (
              <div style={{ marginTop: 16, maxWidth: 360 }}>
                <Timer view={view} now={now} secondsLeft={secondsLeft} />
              </div>
            )}
          </div>
        )}

        {!isLobby && !isOver && mySeat == null && vacancies.length > 0 && (
          <div className="banner info" style={{ marginTop: 14 }}>
            有 {vacancies.length} 个空位。点观战席上的「接替」就能上场，沿用那个座位的词和身份。
          </div>
        )}

        {isOver && (
          <div className="banner info" style={{ marginTop: 14 }}>
            这局结束了。房主点「返回大厅」后，你可以在大厅里加入下一局。
          </div>
        )}

        {err && <div className="banner err" style={{ marginTop: 14 }}>{err}</div>}

        <div className="panel" style={{ marginTop: 14 }}>
          <div className="h">最新播报</div>
          <Ticker events={view.events} limit={6} />
        </div>

        <div style={{ marginTop: 14 }}>
          <ChatPanel view={view} onSend={(t) => run('chat', { text: t })} height={240} />
        </div>

        <p className="notice center" style={{ marginTop: 16 }}>
          观战看不到任何人的私密词和身份。想正式进场？
          <a href={joinHref(view.code)}>回加入页</a>（大厅里才能加）。
        </p>

        {rules && <RulesModal view={view} onClose={() => setRules(false)} />}
      </div>
    </div>
  )
}