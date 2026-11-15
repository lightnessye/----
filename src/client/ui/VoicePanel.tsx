import type { RoomView } from '../../shared/types'
import { useVoice } from '../voice'

/**
 * 语音开麦面板：开麦后和其他开麦的玩家实时语音（P2P 直连，不过服务器）。
 * 手机玩家页和主持大屏都能开；围观页没有身份，不渲染。
 */
export function VoicePanel({
  view,
  run,
}: {
  view: RoomView
  run: (action: string, payload?: unknown) => Promise<string | null>
}) {
  const v = useVoice(view, run)
  if (!view.me) return null

  const micPeers = view.players.filter((p) => p.micOn && p.id !== view.me!.id)

  return (
    <div className="panel voice-panel">
      <div className="row between" style={{ marginBottom: 10 }}>
        <div className="h" style={{ marginBottom: 0 }}>语音开麦</div>
        {micPeers.length > 0 && <span className="chip hot">{micPeers.length} 人开麦中</span>}
      </div>

      {!v.supported ? (
        <p className="notice" style={{ margin: 0 }}>
          当前页面环境开不了麦：麦克风需要 HTTPS 或 localhost。用线上地址打开就能用。
        </p>
      ) : (
        <>
          {v.micOn && !v.localActive ? (
            <div className="row" style={{ gap: 8 }}>
              <button className="btn primary" style={{ flex: 1 }} disabled={v.starting} onClick={v.takeOver}>
                {v.starting ? '正在接管…' : '在这里开麦'}
              </button>
              <button className="btn ghost" onClick={v.toggle}>闭麦</button>
            </div>
          ) : (
            <button
              className={`btn big ${v.micOn ? '' : 'primary'}`}
              style={{ width: '100%' }}
              disabled={v.starting}
              onClick={v.toggle}
            >
              {v.starting ? '正在开麦…' : v.micOn ? '闭麦' : '🎙 开麦'}
            </button>
          )}

          <p className="dim" style={{ margin: '8px 0 0', fontSize: 13 }}>
            {v.micOn && !v.localActive
              ? '麦克风在另一个页面开着，声音从那里进出。'
              : v.micOn
                ? '麦克风开着，其他开麦的人能听见你。'
                : micPeers.length > 0
                  ? `${micPeers.map((p) => p.name).join('、')} 在麦上，开麦加入他们。`
                  : '开麦后和其他开麦的人实时语音，闭麦即退出。'}
          </p>

          {v.error && (
            <div className="banner err" style={{ marginTop: 10 }} role="alert">{v.error}</div>
          )}

          {v.needsTap && (
            <button className="btn" style={{ width: '100%', marginTop: 10 }} onClick={v.tapListen}>
              🔊 浏览器拦了声音，点一下收听
            </button>
          )}

          {v.localActive && v.peers.length > 0 && (
            <div className="stack" style={{ gap: 6, marginTop: 10 }}>
              {v.peers.map((p) => (
                <div className="row between" key={p.id}>
                  <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {p.name}
                  </span>
                  <span className={`chip ${p.state === 'connected' ? 'cool' : 'dim'}`}>
                    {p.state === 'connected' ? '已接通' : '连接中…'}
                  </span>
                </div>
              ))}
            </div>
          )}

          <p className="notice" style={{ marginTop: 10, marginBottom: 0 }}>
            声音在玩家设备间直连。同一屋里多台设备同时外放容易啸叫，建议戴耳机。
          </p>
        </>
      )}
    </div>
  )
}