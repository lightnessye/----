import { useEffect } from 'react'
import type { RoomView } from '../../shared/types'

/** 规则小窗：盖在当前页面上方，看完即关，不打断游戏 */
export function RulesModal({ view, onClose }: { view: RoomView; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const m = view.meta
  return (
    <div className="modal-scrim" onClick={onClose} role="dialog" aria-modal="true" aria-label={`${m.name} 规则`}>
      <div className="modal rules-modal" style={{ ['--c' as any]: m.color }} onClick={(e) => e.stopPropagation()}>
        <div className="game-detail-top">
          <button type="button" className="game-detail-close" aria-label="关闭规则" onClick={onClose}>
            ✕
          </button>
          <div className="game-detail-emoji">{m.emoji}</div>
          <h2 className="game-detail-name">{m.name} · 规则</h2>
          <div className="game-detail-tagline">{m.tagline}</div>
          <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
            <span className="chip">{m.minPlayers}–{m.maxPlayers} 人</span>
            <span className="chip">{m.minutes[0]}–{m.minutes[1]} 分钟</span>
            <span className="chip">
              {m.needs.phones === 'each' ? '人手一机' : m.needs.phones === 'none' ? '不用手机' : '一台设备'}
            </span>
          </div>
        </div>
        <div className="game-detail-body">
          <p className="sub game-detail-desc">{m.desc}</p>
          <h3>怎么玩</h3>
          <ol className="howto">
            {m.howTo.map((h, i) => (
              <li key={i}>{h}</li>
            ))}
          </ol>
          <h3>裁判</h3>
          <p className="sub">{m.judgeNote}</p>
          {m.props.length > 0 && (
            <>
              <h3>需要的道具</h3>
              <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                {m.props.map((p) => (
                  <span className="chip" key={p}>{p}</span>
                ))}
              </div>
            </>
          )}
          <button type="button" className="btn primary big" style={{ width: '100%', marginTop: 18 }} onClick={onClose}>
            看完了，继续
          </button>
        </div>
      </div>
    </div>
  )
}