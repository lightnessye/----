import type { RoomView } from '../../shared/types'
import { AvatarBadge } from './Avatar'

/**
 * 玩家头像墙：一行四个，左上角小号角，名字在头像下方。
 * 房主在大厅里可以直接从这里的 ✕ 踢人。
 */
export function PlayerGrid({
  view,
  turnId,
  onKick,
}: {
  view: RoomView
  turnId?: string | null
  onKick?: (playerId: string, name: string) => void
}) {
  if (!view.players.length) return <p className="dim">还没有玩家进场。</p>
  return (
    <div className="player-grid">
      {view.players.map((p) => {
        const isTurn = !!turnId && p.id === turnId
        const isReferee = view.judgeMode === 'human' && view.refereeId === p.id
        const sitsOut =
          p.isHost && (!view.hostPlays || isReferee)
        return (
          <div
            key={p.id}
            className={`pg-cell${p.alive ? '' : ' out'}${view.me?.id === p.id ? ' me' : ''}${isTurn ? ' turn' : ''}`}
          >
            <div className="pg-avatar">
              <AvatarBadge id={p.avatar} seat={p.seat} size={58} />
              <span className="pg-seat">{p.seat}</span>
              {p.micOn && <span className="pg-mic" title="开麦中">🎙</span>}
              {!p.connected && <span className="pg-off" title="离线">离线</span>}
              {onKick && !p.isHost && (
                <button
                  type="button"
                  className="pg-kick"
                  title={`把 ${p.name} 请出房间`}
                  aria-label={`把 ${p.name} 请出房间`}
                  onClick={() => onKick(p.id, p.name)}
                >
                  ✕
                </button>
              )}
            </div>
            <div className="pg-name" title={p.name}>
              {p.isHost && <span className="pg-crown" title="房主">👑</span>}
              {p.name}
            </div>
            <div className="pg-tag">
              {isReferee ? '裁判' : sitsOut ? '主持' : p.watching ? '观战中' : !p.alive ? (p.outReason ?? '出局') : isTurn ? '行动中' : view.judgeMode === 'ai' && p.score > 0 ? `${p.score} 分` : ' '}
            </div>
          </div>
        )
      })}
    </div>
  )
}