import type { RoomView } from '../../shared/types'
import { useVoice } from '../voice'

/**
 * 语音面板：麦克风和扬声器两个独立开关放在同一处。
 * 麦克风 = 别人能不能听见我；扬声器 = 我这边外放不放别人的声音。
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
        <div className="h" style={{ marginBottom: 0 }}>语音</div>
        {micPeers.length > 0 && <span className="chip hot">{micPeers.length} 人开麦中</span>}
      </div>

      {!v.supported ? (
        <p className="notice" style={{ margin: 0 }}>
          当前页面环境开不了麦：麦克风需要 HTTPS 或 localhost。用线上地址打开就能用。
        </p>
      ) : (
        <>
          <div className="voice-duo">
            <button
              type="button"
              className={`voice-toggle${v.micOn ? ' on mic' : ''}`}
              disabled={v.starting}
              onClick={v.toggle}
              aria-pressed={v.micOn}
            >
              <span className="vt-icon">{v.micOn ? '🎙' : '🎤'}</span>
              <b>麦克风</b>
              <span className="vt-state">
                {v.starting ? '正在开麦…' : v.micOn ? (v.localActive ? '开着 · 点我闭麦' : '在别的页面开着') : '已关 · 点我开麦'}
              </span>
            </button>
            <button
              type="button"
              className={`voice-toggle${v.speakerOn ? ' on spk' : ''}`}
              onClick={v.toggleSpeaker}
              aria-pressed={v.speakerOn}
            >
              <span className="vt-icon">{v.speakerOn ? '🔊' : '🔇'}</span>
              <b>扬声器</b>
              <span className="vt-state">{v.speakerOn ? '外放开 · 点我静音' : '已静音 · 点我外放'}</span>
            </button>
          </div>

          {v.micOn && !v.localActive && (
            <button className="btn" style={{ width: '100%', marginTop: 10 }} disabled={v.starting} onClick={v.takeOver}>
              {v.starting ? '正在接管…' : '把麦克风抢到这个页面'}
            </button>
          )}

          <p className="dim" style={{ margin: '8px 0 0', fontSize: 13 }}>
            {!v.speakerOn
              ? '扬声器已静音：你还能说话，但听不到别人。'
              : v.micOn && !v.localActive
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

          {v.needsTap && v.speakerOn && (
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