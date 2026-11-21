import { useRef, useState } from 'react'
import { AVATARS, avatarFor, isPhotoAvatar } from '../../shared/avatars'

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
  if (a.photo) {
    return (
      <span
        className="avatar"
        title={a.label}
        style={{ width: size, height: size, overflow: 'hidden' }}
      >
        <img
          src={a.photo}
          alt={a.label}
          style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
        />
      </span>
    )
  }
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

/** 选照片 → 居中裁方 → 压到 96px JPEG，体积控制在几 KB，房间存储和轮询都扛得住 */
async function fileToAvatar(file: File): Promise<string> {
  const url = URL.createObjectURL(file)
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image()
      el.onload = () => resolve(el)
      el.onerror = () => reject(new Error('这张图片读不出来，换一张试试'))
      el.src = url
    })
    const side = Math.min(img.naturalWidth, img.naturalHeight)
    const canvas = document.createElement('canvas')
    canvas.width = 96
    canvas.height = 96
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('当前浏览器不支持处理图片')
    ctx.drawImage(
      img,
      (img.naturalWidth - side) / 2,
      (img.naturalHeight - side) / 2,
      side,
      side,
      0,
      0,
      96,
      96,
    )
    let out = canvas.toDataURL('image/jpeg', 0.72)
    if (out.length > 24_000) out = canvas.toDataURL('image/jpeg', 0.5)
    if (!isPhotoAvatar(out)) throw new Error('图片处理失败，换一张试试')
    return out
  } finally {
    URL.revokeObjectURL(url)
  }
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
  const fileRef = useRef<HTMLInputElement>(null)
  const [uploadErr, setUploadErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const shuffle = () => {
    const rest = AVATARS.filter((a) => a.id !== picked.id)
    onChange(rest[Math.floor(Math.random() * rest.length)].id)
  }
  const onFile = async (file: File | undefined) => {
    if (!file) return
    setUploadErr(null)
    if (!/^image\//.test(file.type)) {
      setUploadErr('要选图片文件哦')
      return
    }
    setBusy(true)
    try {
      onChange(await fileToAvatar(file))
    } catch (e: any) {
      setUploadErr(e?.message ?? '图片处理失败')
    } finally {
      setBusy(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }
  return (
    <div className={`avatar-picker${compact ? ' compact' : ''}`}>
      <div className="avatar-grid" role="radiogroup" aria-label="选择头像">
        <button
          type="button"
          className={`avatar-opt avatar-upload${isPhotoAvatar(value) ? ' on' : ''}`}
          title="上传自己的照片"
          aria-label="上传自己的照片"
          disabled={busy}
          onClick={() => fileRef.current?.click()}
        >
          {isPhotoAvatar(value) ? (
            <AvatarBadge id={value} size={compact ? 32 : 44} />
          ) : (
            <span
              className="avatar"
              style={{
                width: compact ? 32 : 44,
                height: compact ? 32 : 44,
                fontSize: compact ? 15 : 19,
                background: 'linear-gradient(150deg, #d9efe7, #b7dccf)',
              }}
            >
              {busy ? '…' : '📷'}
            </span>
          )}
        </button>
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
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        style={{ display: 'none' }}
        onChange={(e) => void onFile(e.target.files?.[0])}
      />
      <div className="avatar-pick-foot">
        <span className="dim">
          已选 <b style={{ color: 'var(--accent-2)' }}>{picked.label}</b>
        </span>
        <span className="row" style={{ gap: 10 }}>
          <button type="button" className="btn link" disabled={busy} onClick={() => fileRef.current?.click()}>
            📷 用我的照片
          </button>
          <button type="button" className="btn link" onClick={shuffle}>
            🎲 随机换一个
          </button>
        </span>
      </div>
      {uploadErr && <div className="banner err" style={{ marginTop: 8 }}>{uploadErr}</div>}
    </div>
  )
}