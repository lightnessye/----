import { AVATARS, avatarFor } from '../../shared/avatars'

export function AvatarBadge({
  id,
  seat,
  size = 30,
}: {
  id?: string | null
  seat?: number
  size?: number
}) {
  const a = avatarFor(id, seat)
  return (
    <span
      className="avatar"
      title={a.label}
      style={{
        width: size,
        height: size,
        fontSize: Math.round(size * 0.56),
        background: `linear-gradient(150deg, ${a.from}, ${a.to})`,
      }}
    >
      {a.emoji}
    </span>
  )
}

export function AvatarPicker({
  value,
  onChange,
  compact,
}: {
  value: string
  onChange: (id: string) => void
  compact?: boolean
}) {
  const picked = avatarFor(value)
  const shuffle = () => {
    const rest = AVATARS.filter((a) => a.id !== picked.id)
    onChange(rest[Math.floor(Math.random() * rest.length)].id)
  }
  return (
    <div className={`avatar-picker${compact ? ' compact' : ''}`}>
      <div className="avatar-grid" role="radiogroup" aria-label="选择头像">
        {AVATARS.map((a) => (
          <button
            key={a.id}
            type="button"
            role="radio"
            aria-checked={value === a.id}
            aria-label={a.label}
            title={a.label}
            className={`avatar-opt${value === a.id ? ' on' : ''}`}
            onClick={() => onChange(a.id)}
          >
            <AvatarBadge id={a.id} size={compact ? 32 : 44} />
          </button>
        ))}
      </div>
      <div className="avatar-pick-foot">
        <span className="dim">
          已选 <b style={{ color: 'var(--accent-2)' }}>{picked.label}</b>
        </span>
        <button type="button" className="btn link" onClick={shuffle}>
          🎲 随机换一个
        </button>
      </div>
    </div>
  )
}