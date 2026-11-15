import { judge } from '../judge'
import type {
  FinalResult,
  Player,
  Room,
  RoomView,
  ViewNeeds,
  WolfRole,
  WerewolfData,
} from '../types'
import { ROLE_DESC, ROLE_LABEL, wolfVariant, type WolfVariant } from '../werewolf'
import type { GameEngine } from './contract'
import {
  addScore,
  alive,
  byId,
  ev,
  nameOf,
  phase,
  randInt,
  sanitize,
  seated,
  shuffle,
  wolf,
} from './util'

const NIGHT_MS = 75_000
const SPEAK_MS = 45_000
const VOTE_MS = 45_000

const emptyNight = (): WerewolfData['nightState'] => ({
  wolfVotes: {},
  seerPick: null,
  seerSeen: null,
  witchAct: null,
  guardPick: null,
})

/* ------------------------------ 小工具 ------------------------------ */

const roleOf = (room: Room, id: string): WolfRole => wolf(room).roles[id] ?? 'villager'

const wolves = (room: Room) => alive(room).filter((p) => roleOf(room, p.id) === 'wolf')

const goodAlive = (room: Room) => alive(room).filter((p) => roleOf(room, p.id) !== 'wolf')

/** 夜里要行动的人：活着的狼、预言家、还有药的女巫、守卫 */
function nightActors(room: Room): string[] {
  const d = wolf(room)
  const out: string[] = []
  for (const p of alive(room)) {
    const role = d.roles[p.id]
    if (role === 'wolf') out.push(p.id)
    else if (role === 'seer') out.push(p.id)
    else if (role === 'witch' && (d.potions.save || d.potions.poison)) out.push(p.id)
    else if (role === 'guard') out.push(p.id)
  }
  return out
}

function hasActed(room: Room, id: string): boolean {
  const d = wolf(room)
  const ns = d.nightState
  switch (d.roles[id]) {
    case 'wolf':
      return ns.wolfVotes[id] !== undefined
    case 'seer':
      return ns.seerPick !== null
    case 'witch':
      return ns.witchAct !== null
    case 'guard':
      return ns.guardPick !== null
    default:
      return true
  }
}

const nightReady = (room: Room) => nightActors(room).every((id) => hasActed(room, id))

function aliveTargets(room: Room, except?: string[]) {
  const skip = new Set(except ?? [])
  return alive(room).filter((p) => !skip.has(p.id))
}

/** 按模式发牌；人数和座位对不上时先砍村民，再砍守卫和女巫 */
function rosterFor(v: WolfVariant, n: number): WolfRole[] {
  const list: WolfRole[] = []
  const push = (role: WolfRole, count: number) => {
    for (let i = 0; i < count; i++) list.push(role)
  }
  // 狼人数量跟着实际人数走：约三分之一，且必须少于好人，否则一开局就判狼赢
  const wolfCount = Math.max(1, Math.min(v.roles.wolf, Math.floor(n / 3), Math.floor((n - 1) / 2)))
  push('wolf', wolfCount)
  push('seer', v.roles.seer)
  // 人少的时候先省掉守卫，再省掉女巫，剩下的位置都算村民
  if (n >= 10) push('guard', v.roles.guard)
  if (n >= 7) push('witch', v.roles.witch)
  push('villager', Math.max(0, n - list.length))
  while (list.length > n) {
    const villager = list.lastIndexOf('villager')
    if (villager >= 0) {
      list.splice(villager, 1)
      continue
    }
    const guard = list.indexOf('guard')
    if (guard >= 0) {
      list.splice(guard, 1)
      continue
    }
    const witch = list.indexOf('witch')
    if (witch >= 0) {
      list.splice(witch, 1)
      continue
    }
    const spareWolf = list.lastIndexOf('wolf')
    if (spareWolf >= 0 && list.filter((r) => r === 'wolf').length > 1) {
      list.splice(spareWolf, 1)
      continue
    }
    break
  }
  return list
}

function rosterText(v: WolfVariant, n: number): string {
  const dealt = rosterFor(v, n)
  const order: WolfRole[] = ['wolf', 'seer', 'witch', 'guard', 'villager']
  return order
    .map((role) => `${dealt.filter((r) => r === role).length} ${ROLE_LABEL[role]}`)
    .filter((s) => !s.startsWith('0 '))
    .join(' · ')
}

function checkWin(room: Room): WerewolfData['win'] {
  const d = wolf(room)
  const w = wolves(room).length
  const good = goodAlive(room).length
  if (w === 0) d.win = 'village'
  else if (w >= good) d.win = 'wolf'
  return d.win
}

function killPlayer(room: Room, id: string, reason: string) {
  const d = wolf(room)
  const p = byId(room, id)
  if (!p || !p.alive) return
  p.alive = false
  p.outReason = reason
  d.dead.push(id)
  d.deadRoles[id] = roleOf(room, id)
}

/* ------------------------------ 阶段 ------------------------------ */

function startNight(room: Room) {
  const d = wolf(room)
  d.night = room.round
  d.nightState = emptyNight()
  d.killed = []
  d.poisoned = null
  d.saved = null
  d.speeches = {}
  d.votes = {}
  d.tally = {}
  d.exiled = null
  d.win = null
  phase(room, 'night', { ms: NIGHT_MS, round: room.round, turn: 0 })
  ev(room, 'judge', judge('wolfOpen', {}))
}

function startSpeak(room: Room) {
  const d = wolf(room)
  d.order = alive(room).map((p) => p.id)
  d.cursor = 0
  d.speeches = {}
  const first = d.order[0]
  phase(room, 'speak', { ms: SPEAK_MS, turn: 0 })
  ev(
    room,
    'judge',
    first ? `天亮了，从 ${nameOf(room, first)} 开始发言。` : '天亮了，没有人能发言。',
  )
}

function startVote(room: Room) {
  const d = wolf(room)
  d.votes = {}
  d.tally = {}
  phase(room, 'vote', { ms: VOTE_MS, turn: 0 })
  ev(room, 'judge', '发言结束，开始投票。')
}

function currentSpeaker(room: Room): string | null {
  const d = wolf(room)
  return d.order[d.cursor] ?? null
}

/** 发言往下走；走完了就进投票 */
function advanceSpeak(room: Room) {
  const d = wolf(room)
  d.order = d.order.filter((id) => byId(room, id)?.alive)
  if (d.cursor >= d.order.length - 1) {
    startVote(room)
    return
  }
  d.cursor += 1
  phase(room, 'speak', { ms: SPEAK_MS, turn: d.cursor })
}

/** 结算夜里：守卫 → 狼刀 → 女巫 → 天亮 */
function resolveNight(room: Room) {
  const d = wolf(room)
  const ns = d.nightState
  const livingIds = new Set(alive(room).map((p) => p.id))

  // 狼刀：票最多的那个，平票随机
  const tally: Record<string, number> = {}
  for (const target of Object.values(ns.wolfVotes)) {
    if (livingIds.has(target)) tally[target] = (tally[target] ?? 0) + 1
  }
  let kill: string | null = null
  let top = 0
  for (const [id, n] of Object.entries(tally)) {
    if (n > top) {
      top = n
      kill = id
    }
  }
  if (top > 0) {
    const leaders = Object.entries(tally)
      .filter(([, n]) => n === top)
      .map(([id]) => id)
    kill = leaders.length === 1 ? leaders[0] : leaders[randInt(0, leaders.length - 1)]
  }

  // 女巫
  let poisoned: string | null = null
  if (ns.witchAct === 'save' && kill && d.potions.save) {
    d.potions.save = false
    d.saved = kill
    kill = null
  } else if (ns.witchAct?.startsWith('poison:') && d.potions.poison) {
    const target = ns.witchAct.slice('poison:'.length)
    if (livingIds.has(target)) {
      d.potions.poison = false
      poisoned = target
    }
  }

  // 守卫守得住刀，挡不住毒
  const guard = ns.guardPick
  d.lastGuard = guard
  if (guard && kill && kill === guard) {
    d.saved = guard
    kill = null
  }

  const deaths: string[] = []
  if (kill) deaths.push(kill)
  if (poisoned && !deaths.includes(poisoned)) deaths.push(poisoned)
  deaths.sort((a, b) => (byId(room, a)?.seat ?? 0) - (byId(room, b)?.seat ?? 0))

  d.killed = deaths
  d.poisoned = poisoned && deaths.includes(poisoned) ? poisoned : null
  d.nightState = emptyNight()

  for (const id of deaths) killPlayer(room, id, '夜里出局')
  for (const id of deaths) {
    if (roleOf(room, id) !== 'wolf') {
      for (const w of wolves(room)) addScore(room, w.id, 1)
    } else {
      for (const p of alive(room)) if (roleOf(room, p.id) !== 'wolf') addScore(room, p.id, 1)
    }
  }

  if (deaths.length === 0) {
    ev(room, 'judge', '天亮了，昨晚是平安夜。')
  } else {
    ev(
      room,
      'judge',
      `天亮了，昨晚 ${deaths.map((id) => nameOf(room, id)).join('、')} 出局。`,
    )
  }
  if (d.saved) ev(room, 'judge', `${nameOf(room, d.saved)} 昨晚被守住了。`)

  d.order = alive(room).map((p) => p.id)
  d.cursor = 0
  phase(room, 'dawn', { turn: 0 })
  checkWin(room)
}

/** 结算投票：平票就没人出局 */
function resolveVote(room: Room) {
  const d = wolf(room)
  const tally: Record<string, number> = {}
  for (const [voter, target] of Object.entries(d.votes)) {
    if (!byId(room, voter)?.alive) continue
    if (!byId(room, target)?.alive) continue
    tally[target] = (tally[target] ?? 0) + 1
  }
  d.tally = tally
  let top = 0
  for (const n of Object.values(tally)) if (n > top) top = n
  const leaders = Object.entries(tally)
    .filter(([, n]) => n === top && n > 0)
    .map(([id]) => id)

  if (leaders.length === 1) {
    const out = leaders[0]
    const role = roleOf(room, out)
    d.exiled = out
    killPlayer(room, out, '被投票放逐')
    for (const [voter, target] of Object.entries(d.votes)) {
      if (target !== out) continue
      if (role === 'wolf' && roleOf(room, voter) !== 'wolf') addScore(room, voter, 2)
      if (role !== 'wolf' && roleOf(room, voter) === 'wolf') addScore(room, voter, 1)
    }
    ev(
      room,
      'judge',
      `${nameOf(room, out)} 被投出去了，身份是「${ROLE_LABEL[role]}」。`,
    )
  } else {
    d.exiled = null
    ev(room, 'judge', '票数打平，这一轮没人出局。')
  }

  phase(room, 'exile', { turn: 0 })
  checkWin(room)
}

/* ------------------------------ 引擎 ------------------------------ */

export const werewolfEngine: GameEngine = {
  id: 'werewolf',

  create(room: Room) {
    const v = wolfVariant(room.variant)
    const d: WerewolfData = {
      variant: v.id,
      roles: {},
      night: 0,
      nightState: emptyNight(),
      killed: [],
      poisoned: null,
      saved: null,
      dead: [],
      deadRoles: {},
      order: [],
      cursor: 0,
      speeches: {},
      votes: {},
      tally: {},
      exiled: null,
      win: null,
      potions: { save: true, poison: true },
      lastGuard: null,
      history: [],
    }
    room.data.werewolf = d
  },

  start(room: Room) {
    const v = wolfVariant(room.variant)
    const d = wolf(room)
    const players = seated(room)
    const roster = rosterFor(v, players.length)
    const order = shuffle(players.map((p) => p.id))
    d.variant = v.id
    d.roles = {}
    order.forEach((id, i) => {
      d.roles[id] = roster[i] ?? 'villager'
    })
    for (const p of room.players) {
      p.alive = true
      p.score = 0
      p.outReason = null
    }
    d.night = 1
    d.nightState = emptyNight()
    d.killed = []
    d.poisoned = null
    d.saved = null
    d.dead = []
    d.deadRoles = {}
    d.speeches = {}
    d.votes = {}
    d.tally = {}
    d.exiled = null
    d.win = null
    d.potions = { save: true, poison: true }
    d.lastGuard = null
    d.history = []
    d.cursor = 0
    d.order = players.map((p) => p.id)
    room.startedAt = Date.now()
    room.turn = 0
    room.round = 1
    ev(room, 'judge', `狼人杀开局：${v.name} · ${rosterText(v, players.length)}。身份已经发到各自手机上。`)
    ev(room, 'judge', judge('wolfOpen', {}))
    phase(room, 'night', { ms: NIGHT_MS, round: 1, turn: 0 })
  },

  act(room: Room, actor: Player, action: string, payload: any) {
    const d = wolf(room)
    if (!actor.alive) return

    if (room.phase === 'night') {
      const ns = d.nightState
      const role = d.roles[actor.id]
      if (action === 'wolfKill' && role === 'wolf') {
        const target = String(payload?.target ?? '')
        const victim = byId(room, target)
        if (!victim?.alive || roleOf(room, target) === 'wolf') return
        ns.wolfVotes[actor.id] = target
        if (nightReady(room)) resolveNight(room)
        return
      }
      if (action === 'seerCheck' && role === 'seer') {
        const target = String(payload?.target ?? '')
        const victim = byId(room, target)
        if (!victim?.alive || target === actor.id) return
        ns.seerPick = target
        ns.seerSeen = { id: target, role: roleOf(room, target) }
        d.history.push({ night: d.night, id: target, role: roleOf(room, target) })
        if (nightReady(room)) resolveNight(room)
        return
      }
      if (action === 'witchAct' && role === 'witch') {
        const value = String(payload?.value ?? 'skip')
        if (value === 'save') {
          if (!d.potions.save) return
          ns.witchAct = 'save'
        } else if (value.startsWith('poison:')) {
          if (!d.potions.poison) return
          const target = value.slice('poison:'.length)
          const victim = byId(room, target)
          if (!victim?.alive) return
          ns.witchAct = value
        } else {
          ns.witchAct = 'skip'
        }
        if (nightReady(room)) resolveNight(room)
        return
      }
      if (action === 'guardPick' && role === 'guard') {
        const target = String(payload?.target ?? '')
        const victim = byId(room, target)
        if (!victim?.alive) return
        if (d.lastGuard === target) return
        ns.guardPick = target
        if (nightReady(room)) resolveNight(room)
        return
      }
      return
    }

    if (room.phase === 'speak') {
      if (action !== 'speak') return
      if (currentSpeaker(room) !== actor.id) return
      const text = sanitize(payload?.text, 80)
      if (!text) return
      d.speeches[actor.id] = text
      advanceSpeak(room)
      return
    }

    if (room.phase === 'vote') {
      if (action !== 'vote') return
      const target = String(payload?.target ?? '')
      const victim = byId(room, target)
      if (!victim?.alive || target === actor.id) return
      d.votes[actor.id] = target
      const living = alive(room).map((p) => p.id)
      if (living.every((id) => d.votes[id] !== undefined)) resolveVote(room)
    }
  },

  next(room: Room, actor: Player | null) {
    const d = wolf(room)
    void actor
    if (room.phase === 'lobby') {
      this.start(room)
      return
    }
    if (room.phase === 'night') {
      resolveNight(room)
      return
    }
    if (room.phase === 'dawn') {
      if (d.win) {
        phase(room, 'over')
        return
      }
      startSpeak(room)
      return
    }
    if (room.phase === 'speak') {
      const speaker = currentSpeaker(room)
      if (speaker && d.speeches[speaker] === undefined) {
        d.speeches[speaker] = '（跳过）'
        ev(room, 'judge', judge('hurry', { name: nameOf(room, speaker) }))
      }
      advanceSpeak(room)
      return
    }
    if (room.phase === 'vote') {
      resolveVote(room)
      return
    }
    if (room.phase === 'exile') {
      if (d.win) {
        phase(room, 'over')
        return
      }
      room.round += 1
      startNight(room)
    }
  },

  tick(room: Room, now: number) {
    const d = wolf(room)
    if (room.deadlineAt === null || now < room.deadlineAt) return

    if (room.phase === 'night') {
      resolveNight(room)
      return
    }
    if (room.phase === 'speak') {
      const speaker = currentSpeaker(room)
      if (speaker && d.speeches[speaker] === undefined) {
        d.speeches[speaker] = '（超时）'
        ev(room, 'judge', judge('timeout', { name: nameOf(room, speaker) }))
      }
      advanceSpeak(room)
      return
    }
    if (room.phase === 'vote') {
      resolveVote(room)
    }
  },

  publicData(room: Room): Record<string, any> {
    const d = wolf(room)
    const v = wolfVariant(room.variant || d.variant)
    return {
      werewolf: {
        variant: v.id,
        name: v.name,
        roster: rosterText(v, room.phase === 'lobby' ? Math.max(v.seats, room.players.length) : room.players.length),
        seats: v.seats,
        night: d.night,
        dead: d.dead,
        deadRoles: d.deadRoles,
        killed: d.killed,
        poisoned: d.poisoned,
        saved: d.saved,
        order: d.order,
        cursor: d.cursor,
        speeches: d.speeches,
        votes: room.phase === 'exile' || room.phase === 'over' ? d.votes : {},
        tally: d.tally,
        exiled: d.exiled,
        winner: d.win,
        aliveCount: alive(room).length,
        roundUnit: room.phase === 'night' ? '夜' : '天',
      },
    }
  },

  secretFor(room: Room, me: Player): Record<string, unknown> {
    const d = wolf(room)
    const role = d.roles[me.id]
    if (!role) return {}
    const out: Record<string, unknown> = {
      role,
      label: ROLE_LABEL[role],
      desc: ROLE_DESC[role],
    }
    if (role === 'wolf') {
      out.teammates = room.players
        .filter((p) => p.id !== me.id && d.roles[p.id] === 'wolf')
        .map((p) => ({ id: p.id, name: p.name }))
    }
    if (role === 'seer') out.history = d.history
    if (role === 'witch') out.potions = d.potions
    if (role === 'guard') out.lastGuard = d.lastGuard
    return out
  },

  refereeExtra(_room: Room): Record<string, unknown> {
    return {
      note: '狼人杀由系统自动结算，裁判不用动手；夜里没交的手机端到点会被自动跳过。',
    }
  },

  needs(room: Room, me: Player | null, _view: RoomView): ViewNeeds {
    const d = wolf(room)
    const base: ViewNeeds = {
      prompt: null,
      input: 'none',
      inputHint: '',
      submitted: false,
      hostHint: hostHint(room),
    }
    if (!me) return base
    if (!me.alive) return { ...base, prompt: '你已经出局了，安静看着就行。' }

    if (room.phase === 'night') {
      const ns = d.nightState
      const role = d.roles[me.id]
      if (hasActed(room, me.id) && role !== 'villager') {
        return { ...base, prompt: '今晚已经行动过了，闭眼等天亮。', submitted: true }
      }
      if (role === 'wolf') {
        const targets = alive(room).filter((p) => roleOf(room, p.id) !== 'wolf')
        return {
          ...base,
          prompt: '今晚刀谁？和队友各点一下，票多的那个死。',
          input: 'pick',
          inputHint: '选一个目标',
          valueKey: 'target',
          options: targets.map((p) => ({ value: p.id, label: `${p.seat} 号 · ${p.name}` })),
        }
      }
      if (role === 'seer') {
        return {
          ...base,
          prompt: '今晚查谁？查完你会知道他是狼人还是好人。',
          input: 'pick',
          inputHint: '选一个目标',
          valueKey: 'target',
          options: aliveTargets(room, [me.id]).map((p) => ({
            value: p.id,
            label: `${p.seat} 号 · ${p.name}`,
          })),
        }
      }
      if (role === 'witch') {
        const options: ViewNeeds['options'] = []
        const victim = Object.values(ns.wolfVotes)[0]
        if (d.potions.save) {
          options.push({
            value: 'save',
            label: '用解药',
            hint: victim ? '救下今晚被刀的人' : '今晚还没有人被刀',
          })
        }
        if (d.potions.poison) {
          for (const p of aliveTargets(room, [me.id])) {
            options.push({ value: `poison:${p.id}`, label: `毒 ${p.seat} 号 · ${p.name}` })
          }
        }
        options.push({ value: 'skip', label: '今晚不用药' })
        return {
          ...base,
          prompt: '女巫行动：一瓶解药一瓶毒药，各一次，也可以不用。',
          input: 'pick',
          inputHint: '选一个动作',
          valueKey: 'value',
          options,
        }
      }
      if (role === 'guard') {
        return {
          ...base,
          prompt: '今晚守谁？被守的人今晚刀不死，但不能连着两晚守同一个人。',
          input: 'pick',
          inputHint: '选一个目标',
          valueKey: 'target',
          options: aliveTargets(room, [d.lastGuard ?? '']).map((p) => ({
            value: p.id,
            label: `${p.seat} 号 · ${p.name}`,
          })),
        }
      }
      return { ...base, prompt: '夜里闭眼，天亮再说。' }
    }

    if (room.phase === 'dawn') {
      return {
        ...base,
        prompt: '天亮了。',
        hostHint: d.win ? '按「下一步」结算' : '按「下一步」进入白天发言',
      }
    }

    if (room.phase === 'speak') {
      if (currentSpeaker(room) === me.id) {
        return {
          ...base,
          prompt: '轮到你发言了：说点有用的，别把自己的身份说漏。',
          input: 'text',
          inputHint: '一句话也行，别沉默',
        }
      }
      return { ...base, prompt: `等 ${nameOf(room, currentSpeaker(room))} 说完。` }
    }

    if (room.phase === 'vote') {
      if (d.votes[me.id] !== undefined) return { ...base, prompt: '票已经投出去了。', submitted: true }
      return {
        ...base,
        prompt: '投一个你最怀疑的人，不能投自己。',
        input: 'pick',
        inputHint: '点一下就投出去了',
        valueKey: 'target',
        options: aliveTargets(room, [me.id]).map((p) => ({
          value: p.id,
          label: `${p.seat} 号 · ${p.name}`,
        })),
      }
    }

    if (room.phase === 'exile') {
      return {
        ...base,
        prompt: d.exiled ? `${nameOf(room, d.exiled)} 被放逐了。` : '平票，这一轮没人出局。',
        hostHint: d.win ? '按「下一步」结算' : '按「下一步」进入下一夜',
      }
    }

    return base
  },

  finish(room: Room): FinalResult {
    const d = wolf(room)
    const v = wolfVariant(d.variant)
    const lines: string[] = [`模式：${v.name} · ${rosterText(v, room.players.length)}`]
    if (d.win === 'village') lines.push('狼人全部出局，好人赢下这一局。')
    if (d.win === 'wolf') lines.push('狼人数量追平了好人，狼人赢下这一局。')
    lines.push(
      `一共打了 ${Math.max(1, room.round)} 个晚上，出局顺序：${
        d.dead
          .map((id) => `${nameOf(room, id)}（${ROLE_LABEL[d.deadRoles[id]]}）`)
          .join('、') || '没有人出局'
      }。`,
    )
    const winners = room.players
      .slice()
      .sort((a, b) => b.score - a.score)
      .map((p) => ({
        name: `${p.name} · ${ROLE_LABEL[d.roles[p.id] ?? 'villager']}`,
        score: p.score,
      }))
    return {
      title: d.win === 'wolf' ? '狼人赢了' : d.win === 'village' ? '好人赢了' : '这一局没打完',
      lines,
      winners,
      verdict:
        d.win === 'wolf'
          ? '狼人撑到最后，好人这边下次记得别急着互投。'
          : d.win === 'village'
            ? '狼人被一个个投出去，好人的直觉很准。'
            : '这一局没打完，下次人齐了再来一局。',
    }
  },
}

/** 大屏和房主看到的一句提示 */
function hostHint(room: Room): string {
  const d = wolf(room)
  const phaseName =
    room.phase === 'night'
      ? `第 ${d.night} 夜`
      : room.phase === 'dawn'
        ? '天刚亮'
        : room.phase === 'speak'
          ? `第 ${d.night} 天发言`
          : room.phase === 'vote'
            ? '投票中'
            : room.phase === 'exile'
              ? '放逐结果'
              : ''
  if (!phaseName) return '人齐了点「开始」。'
  return `${phaseName} · ${alive(room).length} 人还活着，按「下一步」可以让卡住的环节往前推进。`
}
