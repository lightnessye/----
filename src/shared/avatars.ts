/** 自选头像：进场前挑一个，座位表、聊天、结算里都认它。 */

export interface AvatarDef {
  id: string
  emoji: string
  label: string
  from: string
  to: string
}

export const AVATARS: AvatarDef[] = [
  { id: 'fox', emoji: '🦊', label: '狐狸', from: '#ffb347', to: '#ff5e62' },
  { id: 'panda', emoji: '🐼', label: '熊猫', from: '#a8e6cf', to: '#3f7d6b' },
  { id: 'frog', emoji: '🐸', label: '青蛙', from: '#b7f34d', to: '#2fae5f' },
  { id: 'cat', emoji: '🐱', label: '猫咪', from: '#ffd76e', to: '#ff9a3d' },
  { id: 'penguin', emoji: '🐧', label: '企鹅', from: '#8fd3ff', to: '#3a6fd8' },
  { id: 'lion', emoji: '🦁', label: '狮子', from: '#ffe08a', to: '#e8960c' },
  { id: 'rabbit', emoji: '🐰', label: '兔子', from: '#ffc2e0', to: '#ff6fae' },
  { id: 'bear', emoji: '🐻', label: '棕熊', from: '#e0b088', to: '#9c6644' },
  { id: 'koala', emoji: '🐨', label: '考拉', from: '#c3cfe2', to: '#6b7f9e' },
  { id: 'tiger', emoji: '🐯', label: '老虎', from: '#ffb36b', to: '#e8542f' },
  { id: 'unicorn', emoji: '🦄', label: '独角兽', from: '#e3b7ff', to: '#8a4fff' },
  { id: 'octopus', emoji: '🐙', label: '章鱼', from: '#ff9d9d', to: '#d8437c' },
  { id: 'whale', emoji: '🐳', label: '鲸鱼', from: '#7ee8fa', to: '#1f7ac9' },
  { id: 'owl', emoji: '🦉', label: '猫头鹰', from: '#b8a6ff', to: '#4d3f9e' },
  { id: 'chick', emoji: '🐥', label: '小鸡', from: '#fff3a0', to: '#f2b705' },
  { id: 'dragon', emoji: '🐲', label: '小龙', from: '#6fe7c8', to: '#0a8f6c' },
]

export const AVATAR_BY_ID: Record<string, AvatarDef> = Object.fromEntries(
  AVATARS.map((a) => [a.id, a]),
)

/** 没挑过 / 传来的 id 不认识时，按座位号发一个，保证人人有头像 */
export function avatarFor(id: unknown, seat = 1): AvatarDef {
  if (typeof id === 'string' && AVATAR_BY_ID[id]) return AVATAR_BY_ID[id]
  return AVATARS[(Math.max(1, Math.round(seat)) - 1) % AVATARS.length]
}

export function sanitizeAvatar(id: unknown, seat = 1): string {
  return avatarFor(id, seat).id
}