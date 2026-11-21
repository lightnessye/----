import type { RoomView } from '../../shared/types'
import { AvatarBadge } from './Avatar'

/** 观战席：房间最上面一条，谁在看一目了然；带座位号的是可接替的空位 */
export function SpectatorBar({
  view,
  onTakeover,
}: {
  view: RoomView
  onTakeover?: (seatPlayerId: string, seat: number) => void
}) {
  const specs = view.spectators ?? []
  return (
    <div className="spectator-bar">
      <span className="sb-label">👀 观战席</span>
      {specs.length === 0 ? (
        <span className="sb-empty">现在没人观战</span>
      ) : (
        <div className="sb-list">
          {specs.map((s) => (
            <span
              key={s.id}
              className={`sb-chip${s.connected ? '' : ' off'}${view.watchMe?.id === s.id ? ' me' : ''}`}
            >
              <AvatarBadge id={s.avatar} size={22} />
              <b>{s.name}</b>
              {s.seat != null &&
                (onTakeover ? (
                  <button
                    type="button"
                    className="sb-take"
                    onClick={() => onTakeover(s.id, s.seat!)}
                    title={`接替 ${s.seat} 号位继续玩`}
                  >
                    接替 {s.seat} 号位
                  </button>
                ) : (
                  <span className="sb-seat">{s.seat} 号位空出</span>
                ))}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}