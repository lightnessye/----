import { useState } from 'react'
<<<<<<< HEAD
import { configure, disbandRoom, kickPlayer, restartRoom } from '../api'
import { useRoom } from '../hooks/useRoom'
import { useShareBase } from '../hooks/useShareBase'
import { uiFor } from '../games'
import { JudgeBadge, QrImage, Scoreboard, SpeakBoard, Ticker, Timer, fmtSpeak } from '../ui/common'
=======
import { configure, pickGame, resetToPicking } from '../api'
import { useRoom } from '../hooks/useRoom'
import { useShareBase } from '../hooks/useShareBase'
import { uiFor } from '../games'
import { GAMES } from '../../shared/games'
import { JudgeBadge, QrImage, Seats, Scoreboard, SpeakBoard, Ticker, Timer, fmtSpeak } from '../ui/common'
>>>>>>> 1e4f489806bd00e01da87f9263e5bdf1bef7f5f2
import { ChatPanel } from '../ui/ChatPanel'
import { VoicePanel } from '../ui/VoicePanel'
import { GameSettings } from '../ui/GameSettings'
import { StageView } from '../ui/StageView'
import { RefereeConsole } from '../ui/RefereeConsole'
import { PlayerGrid } from '../ui/PlayerGrid'
import { SpectatorBar } from '../ui/SpectatorBar'
import { RulesModal } from '../ui/RulesModal'
import { Phone } from './Phone'
import { forgetRoom, go, joinHref, shareJoinHref } from '../route'
import { GAMES } from '../../shared/games'
import { WOLF_VARIANTS } from '../../shared/werewolf'
import type { Player, RoomView } from '../../shared/types'

export function Host({ code, token, watch }: { code: string; token: string | null; watch?: boolean }) {
  const { view, error, secondsLeft, now, run, step, offline, refresh } = useRoom(code, token, watch)
<<<<<<< HEAD
  const [rules, setRules] = useState(false)
  const [overErr, setOverErr] = useState<string | null>(null)
=======
  const [resetErr, setResetErr] = useState<string | null>(null)
  const [resetting, setResetting] = useState(false)
>>>>>>> 1e4f489806bd00e01da87f9263e5bdf1bef7f5f2

  if (error && !view) {
    return (
      <div className="app">
        <div className="wrap center center-v" style={{ minHeight: '80vh' }}>
          <h2>连不上这个房间</h2>
          <p className="sub">{error}</p>
          <a className="btn" href="/">
            回首页开一局新的
          </a>
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

  const ui = uiFor(view)
  const model = ui.stage(view)
  const isLobby = view.phase === 'lobby'
  const isOver = view.phase === 'over'
  const isPicking = view.phase === 'picking'

  /** 结算页「再选游戏」：通知服务端把房间切到选游戏阶段，所有端靠轮询同步 */
  const handleReset = async () => {
    if (!token || resetting) return
    if (!confirm('换个游戏？本局分数会清零，所有人都会进入选游戏环节。')) return
    setResetting(true)
    setResetErr(null)
    try {
      const r = await resetToPicking(view.code, token)
      if (r.error) setResetErr(r.error)
      else refresh()
    } catch (e: any) {
      setResetErr(e?.message ?? '操作失败，重试一下')
    }
    setResetting(false)
  }

  // 房主以玩家身份开局：直接进玩家界面，主持操作在那条主持栏里
  const hostIsPlayer =
    !!view.me && view.hostPlays && !(view.judgeMode === 'human' && view.refereeId === view.me.id)
  if (!isLobby && !watch && hostIsPlayer) {
    return <Phone code={code} token={token} asHost />
  }

  const backToLobby = async () => {
    if (!token) return
    const r = await restartRoom(code, token)
    setOverErr(r.error ?? null)
    if (!r.error) refresh()
  }

  return (
    <div className="app">
      <div className="stage">
        <div className="stage-head">
          <div style={{ fontSize: 26 }}>{view.meta.emoji}</div>
          <div>
            <div className="g">{view.meta.name}</div>
            <div className="dim">{view.meta.latin}</div>
          </div>
          <div style={{ marginLeft: 'auto' }} className="row">
            <button type="button" className="btn tiny" onClick={() => setRules(true)}>
              📖 规则
            </button>
            <span className="chip hot">{isLobby ? '房间号' : ui.phaseName(view)}</span>
            {!isLobby && <JudgeBadge view={view} />}
            <span className="chip">{view.players.length} 人</span>
            {offline && <span className="chip" style={{ color: 'var(--bad)' }}>重连中…</span>}
          </div>
        </div>

        <SpectatorBar view={view} />

        {isLobby ? (
          <Lobby view={view} token={token} step={step} run={run} now={now} refresh={refresh} />
        ) : (
          <div className="stage-body">
            <div className="stage-main">
              {isPicking ? (
                <GamePicker view={view} token={token} refresh={refresh} />
              ) : (
                <>
                  <StageView model={model} />
                  {['describe', 'speak', 'show', 'run', 'hunt'].includes(view.phase) && (
                    <div style={{ marginTop: 22, maxWidth: 420 }}>
                      <Timer view={view} now={now} secondsLeft={secondsLeft} />
                      {['describe', 'speak', 'show', 'run'].includes(view.phase) && (
                        <p className="dim" style={{ marginTop: 8 }}>
                          每人发言上限 {view.speakSeconds != null ? `${view.speakSeconds} 秒` : '默认'}
                          {view.speakingId ? ' · 计时中' : ''}
                        </p>
                      )}
                    </div>
                  )}

<<<<<<< HEAD
              {!watch && (
                <div className="stagebar">
                  {isOver ? (
                    <button className="btn primary" onClick={() => void backToLobby()}>
                      返回大厅 · 开下一局
                    </button>
                  ) : (
                    <button className="btn go" onClick={() => void step()}>
                      下一步 →
                    </button>
                  )}
                  <a className="btn ghost tiny" href={joinHref(view.code)}>
                    手机加入页
                  </a>
                  {!isOver && (
                    <button
                      className="btn ghost tiny"
                      onClick={() => {
                        if (confirm('直接结算这一局？正在填写的内容会丢掉。')) void step(true)
                      }}
                      style={{ marginLeft: 'auto' }}
                    >
                      提前结束
                    </button>
=======
                  {!watch && (
                    <div className="stagebar">
                      <button className="btn go" onClick={() => void step()}>
                        {isOver ? '停在这一页' : '下一步 →'}
                      </button>
                      {isOver && (
                        <button className="btn" disabled={resetting} onClick={() => void handleReset()}>
                          {resetting ? '正在切换…' : '再选游戏'}
                        </button>
                      )}
                      <a className="btn ghost tiny" href={joinHref(view.code)}>
                        手机加入页
                      </a>
                      {view.me &&
                        view.hostPlays &&
                        !(view.judgeMode === 'human' && view.refereeId === view.me.id) && (
                        <a
                          className="btn ghost tiny"
                          href={phoneHref(view.code)}
                          target="_blank"
                          rel="noreferrer"
                          title="在新标签页打开你自己的玩家页，轮到你时在那里提交"
                        >
                          我也玩
                        </a>
                      )}
                      {!isOver && (
                        <button
                          className="btn ghost tiny"
                          onClick={() => {
                            if (confirm('直接结算这一局？正在填写的内容会丢掉。')) void step()
                          }}
                          style={{ marginLeft: 'auto' }}
                        >
                          提前结束
                        </button>
                      )}
                    </div>
                  )}
                  {resetErr && (
                    <div className="banner err" style={{ marginTop: 12 }}>
                      {resetErr}
                    </div>
>>>>>>> 1e4f489806bd00e01da87f9263e5bdf1bef7f5f2
                  )}
                </>
              )}
              {overErr && <div className="banner err" style={{ marginTop: 10 }}>{overErr}</div>}
            </div>

            <div className="stage-side">
<<<<<<< HEAD
              {!watch && <RefereeConsole view={view} run={run} />}
=======
              {!watch && !isPicking && <RefereeConsole view={view} run={run} />}
              {!watch && !isPicking && <SpeakLimit view={view} token={token} />}
>>>>>>> 1e4f489806bd00e01da87f9263e5bdf1bef7f5f2
              <div className="panel">
                <div className="h">裁判播报</div>
                <Ticker events={view.events} limit={9} />
              </div>
              <div className="panel">
                <div className="h">在场玩家</div>
<<<<<<< HEAD
                <PlayerGrid view={view} turnId={ui.turnId?.(view) ?? null} />
=======
                <Seats view={view} turnId={isPicking ? null : ui.turnId?.(view) ?? null} compact />
>>>>>>> 1e4f489806bd00e01da87f9263e5bdf1bef7f5f2
              </div>
              {!isPicking && <SpeakBoard view={view} now={now} />}
              <VoicePanel view={view} run={run} />
              <ChatPanel
                view={view}
                onSend={watch ? undefined : (t) => run('chat', { text: t })}
                height={240}
              />
              {view.judgeMode === 'ai' && !isPicking && (
                <div className="panel">
                  <div className="h">分数</div>
                  <Scoreboard players={view.players} />
                </div>
              )}
              {isOver && view.finished && <Result view={view} />}
            </div>
          </div>
        )}

        {rules && <RulesModal view={view} onClose={() => setRules(false)} />}
      </div>
    </div>
  )
}

function Lobby({
  view,
  token,
  step,
  run,
  now,
  refresh,
}: {
  view: RoomView
  token: string | null
  step: () => Promise<string | null>
  run: (a: string, p?: unknown) => Promise<string | null>
  now: number
  refresh: () => void
}) {
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const base = useShareBase()
  const href = shareJoinHref(view.code, base)
  const host = view.players.find((p) => p.isHost)
  const hostIsReferee = view.judgeMode === 'human' && !!host && view.refereeId === host.id
  const sitsOut = (p: Player) =>
    p.isHost && (!view.hostPlays || (view.judgeMode === 'human' && view.refereeId === p.id))
  const participants = view.players.filter((p) => !sitsOut(p)).length
  const canStart = participants >= view.meta.minPlayers
  const needReferee = view.judgeMode === 'human' && !view.refereeId
  const aiOnly = view.meta.judgeModes.length === 1 && view.meta.judgeModes[0] === 'ai'

  const setMode = async (m: 'ai' | 'human') => {
    if (!token) return
    setBusy(true)
    const r = await configure(view.code, token, { judgeMode: m })
    setErr(r.error ?? null)
    setBusy(false)
  }

  const setReferee = async (id: string | null) => {
    if (!token) return
    setBusy(true)
    const r = await configure(view.code, token, { refereeId: id })
    setErr(r.error ?? null)
    setBusy(false)
  }

  const setVariant = async (variant: string) => {
    if (!token) return
    setBusy(true)
    const r = await configure(view.code, token, { variant })
    setErr(r.error ?? null)
    setBusy(false)
  }

  const switchGame = async (gameId: string) => {
    if (!token || gameId === view.gameId) return
    setBusy(true)
    const r = await configure(view.code, token, { gameId })
    setErr(r.error ?? null)
    setBusy(false)
    refresh()
  }

  const setHostPlays = async (on: boolean) => {
    if (!token) return
    setBusy(true)
    const r = await configure(view.code, token, { hostPlays: on })
    setErr(r.error ?? null)
    setBusy(false)
  }

  const kick = async (id: string, name: string) => {
    if (!token) return
    if (!confirm(`把 ${name} 移出房间？只有开局前能踢人。`)) return
    const r = await kickPlayer(view.code, token, id)
    setErr(r.error ?? null)
    refresh()
  }

  const disband = async () => {
    if (!token) return
    if (!confirm('解散这个房间？所有人都要重新开一局。')) return
    const r = await disbandRoom(view.code, token)
    if (r.error) {
      setErr(r.error)
      return
    }
    forgetRoom(view.code)
    go('/')
  }

  const seatedCount = view.players.filter((p) => !p.watching).length

  return (
    <div className="stage-body">
      <div className="stage-main">
        <div className="card accent" style={{ display: 'flex', gap: 22, alignItems: 'center', flexWrap: 'wrap' }}>
          <div className="qr">
            <QrImage text={href} />
          </div>
          <div style={{ minWidth: 220 }}>
            <div className="dim" style={{ letterSpacing: '0.2em' }}>
              房间号
            </div>
            <div className="mega" style={{ color: 'var(--accent-2)' }}>
              {view.code}
            </div>
            <p className="sub" style={{ marginTop: 4 }}>
              大家在手机浏览器打开
            </p>
            <a href={href} style={{ wordBreak: 'break-all', fontWeight: 700 }}>
              {href}
            </a>
            <p className="notice" style={{ marginTop: 10 }}>
              扫上面的码，或者手动输入网址，然后填房间号。
              {base && new URL(base).host !== location.host && '手机要和这台电脑连同一个 WiFi 才打得开这个地址。'}
            </p>
          </div>
        </div>

        <div className="panel">
          <div className="h">这局玩什么 · 开局前随时换</div>
          <div className="game-switch">
            {GAMES.map((g) => {
              const on = g.id === view.gameId
              const tooMany = seatedCount > g.maxPlayers
              return (
                <button
                  key={g.id}
                  type="button"
                  className={`gs-item${on ? ' on' : ''}${tooMany && !on ? ' disabled' : ''}`}
                  disabled={busy || on || tooMany}
                  title={tooMany ? `现在 ${seatedCount} 人，超过这个游戏上限 ${g.maxPlayers} 人` : g.desc}
                  onClick={() => void switchGame(g.id)}
                >
                  <span className="gs-emoji">{g.emoji}</span>
                  <span className="gs-name">{g.name}</span>
                  <span className="gs-meta">
                    {g.minPlayers}–{g.maxPlayers} 人 · {g.minutes[0]}–{g.minutes[1]} 分钟
                  </span>
                </button>
              )
            })}
          </div>
          <p className="notice" style={{ marginTop: 10, marginBottom: 0 }}>
            换游戏会重置本局设置，开局后就不能再换了。
          </p>
        </div>

        <div className="panel">
          <div className="h">这局怎么玩</div>
          <p className="sub" style={{ marginBottom: 12 }}>
            {view.meta.desc}
          </p>
          <ol className="howto">
            {view.meta.howTo.map((h, i) => (
              <li key={i}>{h}</li>
            ))}
          </ol>
          <div className="row" style={{ marginTop: 14 }}>
            <span className="chip">
              {view.meta.minPlayers}–{view.meta.maxPlayers} 人
            </span>
            <span className="chip">
              {view.meta.minutes[0]}–{view.meta.minutes[1]} 分钟
            </span>
            <span className="chip">
              {view.meta.needs.phones === 'each'
                ? '需要人手一台手机'
                : view.meta.needs.phones === 'none'
                  ? '完全不用手机'
                  : '一台设备就够'}
            </span>
          </div>
        </div>

        <div className="panel">
          <div className="h">房主身份</div>
          <div className="seg">
            <button
              className={view.hostPlays ? 'on' : ''}
              disabled={busy}
              onClick={() => void setHostPlays(true)}
            >
              🎮 我也玩
            </button>
            <button
              className={!view.hostPlays ? 'on' : ''}
              disabled={busy}
              onClick={() => void setHostPlays(false)}
            >
              🎬 只主持
            </button>
          </div>
          <p className="notice" style={{ marginTop: 10, marginBottom: 0 }}>
            {view.hostPlays
              ? '开局后你的手机页就是玩家界面，顶上多一条主持栏（下一步 / 提前结束 / 返回大厅）。'
              : '开局后你留在大屏当主持，不占玩家座位。'}
            {hostIsReferee && ' 你现在被选为真人裁判，开局后以裁判界面为准。'}
          </p>
        </div>

        <div className="panel">
          <div className="h">裁判由谁当</div>
          <div className="seg" style={{ marginBottom: 14 }}>
            <button
              className={view.judgeMode === 'ai' ? 'on' : ''}
              disabled={busy || aiOnly}
              onClick={() => void setMode('ai')}
            >
              🤖 AI 裁判
            </button>
            <button
              className={view.judgeMode === 'human' ? 'on' : ''}
              disabled={busy || aiOnly}
              onClick={() => void setMode('human')}
            >
              🧑‍⚖️ 真人裁判
            </button>
          </div>
          <p className="notice" style={{ marginBottom: 12 }}>
            {view.meta.judgeNote}
          </p>
          {view.judgeMode === 'human' && (
            <>
              <label className="blk">从下面这些人里选一个当裁判</label>
              <div className="seats">
                {view.players.map((p) => (
                  <button
                    key={p.id}
                    className={`opt ${view.refereeId === p.id ? 'on' : ''}`}
                    style={{ width: 'auto' }}
                    disabled={busy}
                    onClick={() => void setReferee(p.id)}
                  >
                    <b>{p.name}</b>
                    <span>{p.isHost ? '房主' : `${p.seat} 号`}</span>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>

        {view.gameId === 'werewolf' && (
          <div className="panel">
            <div className="h">规模与角色表</div>
            <div className="wolf-modes" style={{ marginBottom: 10 }}>
              {WOLF_VARIANTS.map((v) => {
                const on = (view.publicData?.werewolf?.variant ?? '') === v.id
                return (
                  <button
                    key={v.id}
                    type="button"
                    className={`wolf-mode${on ? ' on' : ''}`}
                    disabled={busy}
                    onClick={() => void setVariant(v.id)}
                  >
                    <div className="wm-top">
                      <b>{v.name}</b>
                      <span className="chip">{v.seats} 人</span>
                    </div>
                    <div className="wm-roster">{v.roster}</div>
                    <div className="wm-tag">{v.tagline}</div>
                  </button>
                )
              })}
            </div>
            <p className="notice" style={{ marginBottom: 0 }}>
              人数不够会少发村民，人数超了就多发村民，狼人、预言家、女巫、守卫的数量按上表来。
            </p>
          </div>
        )}

        <SpeakLimit view={view} token={token} />

        {err && <div className="banner err">{err}</div>}
        {needReferee && <div className="banner info">真人裁判模式还差一步：上面选一个裁判。</div>}

        <GameSettings view={view} token={token} refresh={refresh} />

        <div className="stagebar">
          <button
            className="btn primary big"
            style={{ maxWidth: 380 }}
            disabled={!canStart || needReferee || busy}
            onClick={async () => {
              setBusy(true)
              const e = await step()
              setErr(e)
              setBusy(false)
            }}
          >
            {canStart ? `开始这局（${participants} 人）` : `还差 ${view.meta.minPlayers - participants} 个人`}
          </button>
          <span className="dim">
            最少 {view.meta.minPlayers} 人。现在 {participants} 人 · {Math.round((now / 1000) % 60)}
          </span>
          <button
            className="btn ghost tiny"
            style={{ marginLeft: 'auto', color: 'var(--bad)' }}
            disabled={busy}
            onClick={() => void disband()}
          >
            解散房间
          </button>
        </div>
      </div>

      <div className="stage-side">
        <div className="panel">
          <div className="h">已经进来的人 · 点 ✕ 可移出</div>
          <PlayerGrid view={view} onKick={(id, name) => void kick(id, name)} />
          {participants < view.meta.minPlayers && (
            <p className="notice" style={{ marginTop: 12 }}>
              把上面那个链接发到聚会群里，人齐了就自动能开始。
            </p>
          )}
        </div>
        <div className="panel">
          <div className="h">进场记录</div>
          <Ticker events={view.events} limit={6} />
        </div>
        <VoicePanel view={view} run={run} />
        <ChatPanel view={view} onSend={(t) => run('chat', { text: t })} height={220} />
      </div>
    </div>
  )
}

function SpeakLimit({ view, token }: { view: RoomView; token: string | null }) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [custom, setCustom] = useState('')
  const cur = view.speakSeconds
  const presets: (number | null)[] = [null, 30, 60, 90, 120]
  const set = async (v: number | null) => {
    if (!token || busy) return
    setBusy(true)
    const r = await configure(view.code, token, { speakSeconds: v })
    setErr(r.error ?? null)
    setBusy(false)
  }
  return (
    <div className="panel">
      <div className="h">每人发言时长</div>
      <div className="seg" style={{ flexWrap: 'wrap' }}>
        {presets.map((v) => (
          <button
            key={v ?? 'default'}
            className={cur === v ? 'on' : ''}
            disabled={busy}
            onClick={() => void set(v)}
          >
            {v === null ? '默认' : `${v} 秒`}
          </button>
        ))}
      </div>
      <div className="row" style={{ marginTop: 10, gap: 8 }}>
        <input
          className="field"
          type="number"
          min={10}
          max={300}
          placeholder="自定义秒数"
          value={custom}
          onChange={(e) => setCustom(e.target.value)}
          style={{ maxWidth: 150 }}
        />
        <button
          className="btn tiny"
          disabled={busy || !custom}
          onClick={() => {
            const n = Number(custom)
            if (Number.isFinite(n)) void set(n)
          }}
        >
          设定
        </button>
      </div>
      <p className="notice" style={{ marginTop: 10, marginBottom: 0 }}>
        轮到每个人发言 / 表演时的倒计时上限。开局后锁定，玩到一半不能改；默认按各游戏推荐值。
      </p>
      {err && <div className="banner err" style={{ marginTop: 10 }}>{err}</div>}
    </div>
  )
}

/** picking 阶段：房主在房间里直接挑下一局，其他端只能看。复用首页候选列表的 .alts/.alt 样式。 */
function GamePicker({
  view,
  token,
  refresh,
}: {
  view: RoomView
  token: string | null
  refresh: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const n = view.players.length
  const canPick = !!token && view.role === 'host'

  const choose = async (gameId: string) => {
    if (!token || busy) return
    setBusy(true)
    setErr(null)
    try {
      const r = await pickGame(view.code, token, gameId)
      if (r.error) setErr(r.error)
      else refresh()
    } catch (e: any) {
      setErr(e?.message ?? '选游戏失败，重试一下')
    }
    setBusy(false)
  }

  return (
    <div className="panel">
      <div className="h">再选一局</div>
      <p className="sub" style={{ marginBottom: 12 }}>
        {canPick
          ? '房间号和人都还在，挑一个接着玩。选好后大家自动进新游戏的大厅。'
          : '房主正在挑下一个游戏，选好了这里会自动变成新游戏的大厅。'}
      </p>
      {err && (
        <div className="banner err" style={{ marginBottom: 12 }}>
          {err}
        </div>
      )}
      <div className="alts">
        {GAMES.map((g) => {
          const fit = n >= g.minPlayers && n <= g.maxPlayers
          return (
            <button
              key={g.id}
              type="button"
              className="alt"
              disabled={!canPick || busy || !fit}
              onClick={() => void choose(g.id)}
            >
              <span className="e">{g.emoji}</span>
              <span>
                <div className="n">
                  {g.name}
                  {g.id === view.gameId ? '（刚才玩的）' : ''}
                </div>
                <div className="t">{fit ? g.tagline : `要 ${g.minPlayers}–${g.maxPlayers} 人，现在 ${n} 人`}</div>
              </span>
              <span className="m">
                {g.minutes[0]}–{g.minutes[1]} 分钟
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

function Result({ view }: { view: RoomView }) {
  const f = view.finished
  if (!f) return null
  const board =
    f.board ?? f.winners.map((w, i) => ({ rank: i + 1, name: w.name, score: w.score, win: i === 0 }))
  const talkers = view.players
    .map((p) => ({ name: p.name, ms: p.speakMs ?? 0 }))
    .filter((t) => t.ms > 0)
    .sort((a, b) => b.ms - a.ms)
  return (
    <div className="panel" style={{ borderColor: 'rgba(10,159,131,.38)' }}>
      <div className="h">结算</div>
      <h2 style={{ marginBottom: 8 }}>{f.title}</h2>
      {f.lines.map((l, i) => (
        <p className="sub" key={i} style={{ margin: '4px 0' }}>
          {l}
        </p>
      ))}
      <div className="divider" />
      <div className="h" style={{ marginBottom: 8 }}>排行榜</div>
      <div className="stack" style={{ gap: 8 }}>
        {board.map((b, i) => (
          <div className={`rank${b.win ? ' win' : ''}`} key={i}>
            <span className="no">{b.rank}</span>
            <b>{b.name}</b>
            {b.win && <span className="win-tag">胜</span>}
            <span className="sc">{b.score}</span>
          </div>
        ))}
      </div>
      {talkers.length > 0 && (
        <>
          <div className="divider" />
          <div className="h" style={{ marginBottom: 8 }}>发言时长</div>
          <div className="stack" style={{ gap: 7 }}>
            {talkers.map((t) => (
              <div className="score-line" key={t.name}>
                <span className="dim">{t.name}</span>
                <b className="mono">{fmtSpeak(t.ms)}</b>
              </div>
            ))}
          </div>
        </>
      )}
      <p className="notice" style={{ marginTop: 12 }}>
        {f.verdict}
      </p>
    </div>
  )
}

export { Result }
