import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { createRoom } from '../api'
import { GAME_BY_ID, GAMES } from '../../shared/games'
import { recommend } from '../../shared/recommend'
import { WOLF_VARIANTS } from '../../shared/werewolf'
import type { Intimacy, Profile, Setting, Vibe } from '../../shared/types'
import { gamesHref, go, hostHref, saveToken } from '../route'
import { JoinRoomCard } from '../ui/JoinRoomCard'
import { sanitizeAvatar } from '../../shared/avatars'
import { AvatarPicker } from '../ui/Avatar'
import { RecentRooms } from '../ui/RecentRooms'

const VIBES: { v: Vibe; label: string; hint: string }[] = [
  { v: 'laugh', label: '爆笑', hint: '笑到缺氧，拍照留念' },
  { v: 'warm', label: '走心', hint: '聊出点平时不会说的话' },
  { v: 'brain', label: '烧脑', hint: '推理、还原、抓内鬼' },
  { v: 'rival', label: '竞技', hint: '要有输赢，要有惩罚' },
]

const SETTINGS: { s: Setting; label: string; hint: string; short: string }[] = [
  { s: 'seated', label: '围着桌子坐', hint: '饭店、会议桌、烧烤摊', short: '围桌坐' },
  { s: 'standing', label: '站着 / 有空间走动', hint: '客厅、露台、活动室', short: '有空间' },
  { s: 'lounging', label: '沙发上瘫着', hint: 'KTV、民宿、家里趴着', short: '瘫沙发' },
]

const INTIMACY: { i: Intimacy; label: string; hint: string }[] = [
  { i: 'strangers', label: '基本不认识', hint: '刚开始破冰，名字都还叫不全' },
  { i: 'colleagues', label: '同事，但不熟', hint: '工作关系为主，需要一点分寸感' },
  { i: 'friends', label: '都是老朋友', hint: '知根知底，玩笑可以开大一点' },
  { i: 'family', label: '亲戚 / 有大有小', hint: '年龄跨度大，最好人人能上手' },
]

const SHY = [
  { n: 0, label: '全是社牛', hint: '抢着表演，不怕被围观' },
  { n: 1, label: '有几个慢热', hint: '熟了之后放得开' },
  { n: 2, label: '一半以上不敢开口', hint: '最好不用主动表演' },
] as const

/** 人数可自由填，但推荐引擎的可用区间就到这里：3 是全场最小的开局人数，24 是最大一款游戏的上限 */
const COUNT_MIN = 3
const COUNT_MAX = 24
/** 常见局的人数，点一下就到位；剩下的数字靠滑杆或直接输入 */
const COUNT_PRESETS = [4, 6, 8, 10, 12, 16, 20]
const TOTAL_STEPS = 8

const DEFAULT_PROFILE: Profile = {
  count: 8,
  minutes: 12,
  setting: 'seated',
  vibes: ['laugh'],
  intimacy: 'friends',
  shyLevel: 1,
  propsOk: true,
  phonePerPerson: true,
  wantMove: false,
}

const SETTING_SHORT: Record<Setting, string> = {
  seated: '围桌坐',
  standing: '可走动',
  lounging: '瘫沙发',
}

export function Home() {
  const [stage, setStage] = useState<'intro' | 'survey' | 'result'>('intro')
  /** 结果分三屏：推荐（rec）、全部游戏（games）、狼人杀选模式（wolf） */
  const [screen, setScreen] = useState<'rec' | 'games' | 'wolf'>('rec')
  /** 从哪一屏点进狼人杀选模式的，返回时要回那一屏 */
  const [wolfFrom, setWolfFrom] = useState<'rec' | 'games'>('games')
  const [step, setStep] = useState(0)
  const [profile, setProfile] = useState<Profile>(DEFAULT_PROFILE)
  const [hostName, setHostName] = useState('')
  const [hostAvatar, setHostAvatar] = useState(() => sanitizeAvatar(localStorage.getItem('icebreaker.avatar')))
  const [rank, setRank] = useState(0)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  /** 输入框里的原文。单独存着，才允许先删空再重新输入，不会被夹成 3 或 24 */
  const [countText, setCountText] = useState(String(DEFAULT_PROFILE.count))

  const { picked, dropped } = useMemo(() => recommend(profile), [profile])
  const shown = stage === 'result' ? picked.slice(0, 4) : []
  const safeRank = Math.min(rank, Math.max(0, shown.length - 1))
  const current = shown[safeRank] ?? null
  /** 全部 8 款：推荐的按匹配度在前，硬条件不符的排在后面，但仍然可以硬开 */
  const allRanked = useMemo(() => [...picked, ...dropped], [picked, dropped])

  const canNext = step !== 3 || profile.vibes.length > 0

  const set = <K extends keyof Profile>(k: K, v: Profile[K]) =>
    setProfile((p) => ({ ...p, [k]: v }))

  /** 加减按钮、滑杆、快捷数字、失焦都走这里：一次到位并夹进合法区间 */
  const commitCount = (value: number) => {
    const n = Math.round(Number(value))
    const v = Number.isFinite(n) ? Math.min(COUNT_MAX, Math.max(COUNT_MIN, n)) : profile.count
    set('count', v)
    setCountText(String(v))
  }

  /** 打字过程中只记录原文，合法的值立刻生效，越界的等失焦再夹回来 */
  const typeCount = (raw: string) => {
    if (!/^\d{0,2}$/.test(raw)) return
    setCountText(raw)
    const n = Number(raw)
    if (raw !== '' && n >= COUNT_MIN && n <= COUNT_MAX) set('count', n)
  }

  useEffect(() => {
    window.scrollTo(0, 0)
  }, [step, stage])

  const start = () => {
    setStep(0)
    setRank(0)
    setErr(null)
    setStage('survey')
  }

  /** 单选步骤点完稍等一下自动进入下一步，像系统设置里的选择列表 */
  const advanceSoon = () => {
    if (step >= TOTAL_STEPS - 1) return
    const from = step
    window.setTimeout(() => {
      setStep((s) => (s === from ? Math.min(TOTAL_STEPS - 1, from + 1) : s))
    }, 190)
  }

  const back = () => {
    if (step > 0) setStep((s) => s - 1)
    else setStage('intro')
  }

  const next = () => {
    if (!canNext) return
    // 第 1 步输入框可能被清空还没失焦，离开前先把数字补回去
    if (step === 0) commitCount(profile.count)
    if (step < TOTAL_STEPS - 1) setStep((s) => s + 1)
    else {
      setRank(0)
      setScreen('rec')
      setStage('result')
    }
  }

  const editConditions = () => {
    setStep(0)
    setScreen('rec')
    setStage('survey')
  }

  const accept = async (gameId: string, variant?: string) => {
    // 狼人杀有三种规模，先让玩家选模式再开房间
    if (gameId === 'werewolf' && !variant) {
      setWolfFrom(screen === 'games' ? 'games' : 'rec')
      setScreen('wolf')
      return
    }
    setBusy(true)
    setErr(null)
    try {
      const meta = GAME_BY_ID[gameId]
      const res = await createRoom({
        gameId,
        hostName: hostName.trim() || '房主',
        hostAvatar,
        judgeMode: meta.judgeModes[0],
        profile,
        variant,
      })
      saveToken(res.code, res.token, { gameId, role: 'host' })
      go(hostHref(res.code))
    } catch (e: any) {
      setErr(e?.message ?? '开房间失败了，重试一下')
      setBusy(false)
    }
  }

  if (stage === 'intro') {
    return (
      <div className="app">
        <div className="wrap">
          <div className="center-v home-hero">
            <p className="kicker">ICEBREAKER · 破冰局</p>
            <h1 className="big">
              把冷场
              <br />
              <span className="accent-text">变成一场游戏</span>
            </h1>
            <p className="lead">回答 8 个问题，替你挑出现在最合适的这一局。</p>
            <button className="btn primary big home-cta" onClick={start}>
              开始匹配 →
            </button>
            <button className="btn big home-cta home-browse" onClick={() => go(gamesHref)}>
              🎮 自己挑 · 所有游戏
            </button>

            <JoinRoomCard />

            <div className="home-steps">
              {[
                ['1', '回答 8 个问题', '人数、场合、氛围，一项一项来'],
                ['2', '拿到推荐', '按匹配度排序，附上为什么'],
                ['3', '扫码开局', '大家用手机加入，不用下载'],
              ].map(([n, t, d]) => (
                <div className="home-step" key={n}>
                  <i className="n">{n}</i>
                  <div>
                    <b>{t}</b>
                    <span>{d}</span>
                  </div>
                </div>
              ))}
            </div>

            <p className="notice home-note">现场只要一台设备投屏，其他人扫码加入。</p>

            <div className="home-recent">
              <RecentRooms />
            </div>
          </div>
        </div>
      </div>
    )
  }

  if (stage === 'survey') {
    return (
      <div className="app">
        <div className="wrap wizard">
          <header className="wizard-top">
            <div className="wizard-head">
              <button type="button" className="wizard-back" onClick={back}>
                <ChevronLeft />
                {step === 0 ? '返回' : '上一步'}
              </button>
              <span className="wizard-count">
                第 {step + 1} / {TOTAL_STEPS} 步
              </span>
            </div>
            <div className="wizard-steps" aria-hidden="true">
              {Array.from({ length: TOTAL_STEPS }, (_, i) => (
                <i key={i} className={i <= step ? 'on' : ''} />
              ))}
            </div>
          </header>

          <main className="wizard-main" key={step}>
            {step === 0 && (
              <Step no={0} title="现场几个人？" hint="算上你自己。人数会直接决定哪些游戏能开局。">
                <div className="count-card">
                  <div className="count-display">
                    <button
                      type="button"
                      className="count-step"
                      aria-label="减少一个人"
                      disabled={profile.count <= COUNT_MIN}
                      onClick={() => commitCount(profile.count - 1)}
                    >
                      −
                    </button>

                    <div className="count-value">
                      <input
                        type="number"
                        inputMode="numeric"
                        min={COUNT_MIN}
                        max={COUNT_MAX}
                        step={1}
                        value={countText}
                        aria-label="现场人数"
                        onChange={(e) => typeCount(e.target.value)}
                        onBlur={() => commitCount(countText === '' ? profile.count : Number(countText))}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') e.currentTarget.blur()
                        }}
                      />
                      <span className="count-unit">人</span>
                    </div>

                    <button
                      type="button"
                      className="count-step"
                      aria-label="增加一个人"
                      disabled={profile.count >= COUNT_MAX}
                      onClick={() => commitCount(profile.count + 1)}
                    >
                      +
                    </button>
                  </div>

                  <input
                    type="range"
                    min={COUNT_MIN}
                    max={COUNT_MAX}
                    step={1}
                    value={profile.count}
                    aria-label="拖动选择现场人数"
                    style={
                      {
                        '--fill': `${((profile.count - COUNT_MIN) / (COUNT_MAX - COUNT_MIN)) * 100}%`,
                      } as any
                    }
                    onChange={(e) => commitCount(Number(e.target.value))}
                  />
                  <div className="range-labels">
                    <span>{COUNT_MIN} 人</span>
                    <span>{COUNT_MAX} 人</span>
                  </div>

                  <div className="count-quick">
                    <span className="count-quick-label">常用</span>
                    {COUNT_PRESETS.map((n) => (
                      <button
                        key={n}
                        type="button"
                        aria-pressed={profile.count === n}
                        className={profile.count === n ? 'on' : ''}
                        onClick={() => commitCount(n)}
                      >
                        {n}
                      </button>
                    ))}
                  </div>
                </div>
                <p className="field-note">
                  点加减、拖滑杆、或者直接把数字敲进去都行，{COUNT_MIN}–{COUNT_MAX} 人都能匹配；
                  人越多能开的游戏越少，20 人往上建议拆成两桌。
                </p>
              </Step>
            )}

            {step === 1 && (
              <Step no={1} title="这一局玩多久？" hint="从坐下到收尾，留一点余量，中途还能换一局。">
                <div className="time-card">
                  <div className="time-big">
                    {profile.minutes}
                    <small>分钟</small>
                  </div>
                  <input
                    type="range"
                    min={5}
                    max={30}
                    step={1}
                    value={profile.minutes}
                    aria-label="这一局玩多久"
                    style={
                      {
                        '--fill': `${((profile.minutes - 5) / 25) * 100}%`,
                      } as any
                    }
                    onChange={(e) => set('minutes', Number(e.target.value))}
                  />
                  <div className="range-labels">
                    <span>5 分钟急救</span>
                    <span>30 分钟沉浸</span>
                  </div>
                </div>
                <p className="field-note">时长只影响匹配度，不会硬性筛掉游戏。</p>
              </Step>
            )}

            {step === 2 && (
              <Step no={2} title="现在大家是什么姿势？" hint="场地决定了哪些游戏玩得开。">
                <div className="choice-list" role="radiogroup" aria-label="场地姿势">
                  {SETTINGS.map((x) => (
                    <Choice
                      key={x.s}
                      label={x.label}
                      hint={x.hint}
                      on={profile.setting === x.s}
                      onClick={() => {
                        set('setting', x.s)
                        advanceSoon()
                      }}
                    />
                  ))}
                </div>
              </Step>
            )}

            {step === 3 && (
              <Step no={3} title="想要什么氛围？" hint="可以多选。至少选一个，推荐才有方向。">
                <div className="choice-list" role="group" aria-label="想要的氛围">
                  {VIBES.map((x) => (
                    <Choice
                      key={x.v}
                      multi
                      label={x.label}
                      hint={x.hint}
                      on={profile.vibes.includes(x.v)}
                      onClick={() =>
                        set(
                          'vibes',
                          profile.vibes.includes(x.v)
                            ? profile.vibes.filter((v) => v !== x.v)
                            : [...profile.vibes, x.v],
                        )
                      }
                    />
                  ))}
                </div>
                <p className={`field-note ${profile.vibes.length ? '' : 'warn'}`}>
                  {profile.vibes.length
                    ? `已选 ${profile.vibes.length} 个，可以继续调整。`
                    : '至少选一个氛围，才能继续。'}
                </p>
              </Step>
            )}

            {step === 4 && (
              <Step no={4} title="彼此熟吗？" hint="熟悉程度会影响话题的打开方式。">
                <div className="choice-list" role="radiogroup" aria-label="彼此熟悉程度">
                  {INTIMACY.map((x) => (
                    <Choice
                      key={x.i}
                      label={x.label}
                      hint={x.hint}
                      on={profile.intimacy === x.i}
                      onClick={() => {
                        set('intimacy', x.i)
                        advanceSoon()
                      }}
                    />
                  ))}
                </div>
              </Step>
            )}

            {step === 5 && (
              <Step no={5} title="在场的人放得开吗？" hint="有慢热的人也没关系，我们会把门槛降下来。">
                <div className="choice-list" role="radiogroup" aria-label="在场的人放得开吗">
                  {SHY.map((x) => (
                    <Choice
                      key={x.n}
                      label={x.label}
                      hint={x.hint}
                      on={profile.shyLevel === x.n}
                      onClick={() => {
                        set('shyLevel', x.n)
                        advanceSoon()
                      }}
                    />
                  ))}
                </div>
              </Step>
            )}

            {step === 6 && (
              <Step no={6} title="设备情况" hint="只影响匹配，不会替你决定玩什么。">
                <div className="choice-list">
                  <SwitchRow
                    label="人手一台手机"
                    hint="游戏过程中每个人都要在手机上提交答案"
                    on={profile.phonePerPerson}
                    onClick={() => set('phonePerPerson', !profile.phonePerPerson)}
                  />
                  <SwitchRow
                    label="可以站起来闹"
                    hint="不排斥起身、比划、来回走动"
                    on={profile.wantMove}
                    onClick={() => set('wantMove', !profile.wantMove)}
                  />
                </div>
                <p className="field-note">关掉「人手一台手机」，需要人人用手机的游戏会被直接排除。</p>
              </Step>
            )}

            {step === 7 && (
              <Step no={7} title="最后，谁来当房主？" hint="这个名字会出现在投屏和结算里。">
                <input
                  className="field host-input"
                  placeholder="比如「小李」"
                  value={hostName}
                  maxLength={12}
                  aria-label="房主名字"
                  onChange={(e) => setHostName(e.target.value)}
                />
                <p className="field-note">不填就叫「房主」，之后也能改。</p>
                <label className="blk" style={{ marginTop: 16 }}>
                  你的头像 · 会出现在座位表和聊天里
                </label>
                <AvatarPicker
                  value={hostAvatar}
                  onChange={(id) => {
                    setHostAvatar(id)
                    localStorage.setItem('icebreaker.avatar', id)
                  }}
                />
                <div className="summary-chips">
                  <span className="chip">{profile.count} 人</span>
                  <span className="chip">{profile.minutes} 分钟</span>
                  <span className="chip">{SETTING_SHORT[profile.setting]}</span>
                  <span className="chip">
                    {profile.vibes
                      .map((v) => VIBES.find((x) => x.v === v)?.label)
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                </div>
              </Step>
            )}
          </main>

          <div className="wizard-nav">
            <button
              type="button"
              className="btn primary big"
              disabled={!canNext || busy}
              onClick={next}
            >
              {step === TOTAL_STEPS - 1 ? '给我推荐 →' : canNext ? '继续' : '先选一个氛围'}
            </button>
          </div>
        </div>
      </div>
    )
  }

  const vibesText = profile.vibes
    .map((v) => VIBES.find((x) => x.v === v)?.label)
    .filter(Boolean)
    .join(' · ')

  /** 狼人杀选模式：三种规模各自一套角色表，选完直接开房 */
  if (stage === 'result' && screen === 'wolf') {
    return (
      <div className="app">
        <div className="wrap">
          <header className="result-head">
            <div>
              <p className="kicker">WEREWOLF</p>
              <h1 className="result-title">狼人杀 · 选规模</h1>
            </div>
            <button type="button" className="btn tiny" onClick={() => setScreen(wolfFrom)}>
              ← 返回
            </button>
          </header>

          <div className="row result-meta">
            <span className="chip">你们 {profile.count} 人</span>
            <span className="chip">{profile.minutes} 分钟</span>
            <span className="chip">全场手机上操作</span>
          </div>

          <p className="sub" style={{ marginBottom: 14 }}>
            三种规模的角色表不一样：人少就去掉女巫和守卫，人多再请守卫上场。选一个直接开房，人齐了点开始。
          </p>

          {err && <div className="banner err">{err}</div>}

          <div className="wolf-modes">
            {WOLF_VARIANTS.map((v) => (
              <button
                type="button"
                className="wolf-mode"
                key={v.id}
                disabled={busy}
                onClick={() => void accept('werewolf', v.id)}
              >
                <div className="wm-top">
                  <b>{v.name}</b>
                  <span className="chip">{v.seats} 人版</span>
                </div>
                <div className="wm-roster">{v.roster}</div>
                <div className="wm-tag">{v.tagline}</div>
                <div className="wm-foot">{v.minutes} · 点这里开房 →</div>
              </button>
            ))}
          </div>

          <p className="notice" style={{ marginTop: 14 }}>
            人数和模式对不上时会自动调整村民数量（角色优先保留）；开局之后不能换模式，想换就在大厅里改。
          </p>
        </div>
      </div>
    )
  }

  /** 第二屏：全部游戏。独立一页，点哪款就开哪款，不再跟推荐内容堆在一起 */
  if (stage === 'result' && screen === 'games') {
    return (
      <div className="app">
        <div className="wrap">
          <header className="result-head">
            <div>
              <p className="kicker">ALL GAMES</p>
              <h1 className="result-title">全部 {GAMES.length} 款</h1>
            </div>
            <button type="button" className="btn tiny" onClick={() => setScreen('rec')}>
              ← 返回推荐
            </button>
          </header>

          <div className="row result-meta">
            <span className="chip">{profile.count} 人</span>
            <span className="chip">{profile.minutes} 分钟</span>
            <span className="chip">{SETTING_SHORT[profile.setting]}</span>
            <span className="chip">{vibesText}</span>
          </div>

          <p className="sub" style={{ marginBottom: 14 }}>
            推荐只是建议，想玩哪款点哪款；标着「硬条件不符」的也能开，只是现场会有点别扭。
          </p>

          {err && <div className="banner err">{err}</div>}

          <div className="panel">
            <div className="h">全部 {GAMES.length} 款 · 点一行直接开</div>
            <div className="alts">
              {allRanked.map((x) => {
                const blocked = x.rec.score === 0
                const on = current?.game.id === x.game.id
                return (
                  <button
                    type="button"
                    className={`alt${on ? ' on' : ''}`}
                    key={x.game.id}
                    disabled={busy}
                    onClick={() => void accept(x.game.id)}
                  >
                    <span className="e">{x.game.emoji}</span>
                    <span>
                      <div className="n">
                        {x.game.name}
                        {on && <span className="tag">推荐中</span>}
                        {blocked && <span className="tag off">硬条件不符</span>}
                      </div>
                      <div className="t">{blocked ? x.rec.watch[0] : x.game.tagline}</div>
                    </span>
                    <span className={`m${blocked ? ' off' : ''}`}>
                      {blocked ? `${x.game.minPlayers}–${x.game.maxPlayers} 人` : `${x.rec.percent}%`}
                    </span>
                  </button>
                )
              })}
            </div>
          </div>

          <p className="notice" style={{ marginTop: 12 }}>
            匹配度按你填的条件算。人数不在它的可玩区间时，那局会少一个平民位或者多摊一张牌，开之前跟大家说一声就行。
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="app">
      <div className="wrap">
        <header className="result-head">
          <div>
            <p className="kicker">MATCH RESULT</p>
            <h1 className="result-title">最合适的一局</h1>
          </div>
          <div className="row" style={{ gap: 8 }}>
            <button type="button" className="btn tiny" onClick={() => go(gamesHref)}>
              所有游戏
            </button>
            <button type="button" className="btn tiny" onClick={editConditions}>
              改条件
            </button>
          </div>
        </header>

        <div className="row result-meta">
          <span className="chip">{profile.count} 人</span>
          <span className="chip">{profile.minutes} 分钟</span>
          <span className="chip">{SETTING_SHORT[profile.setting]}</span>
          <span className="chip">{vibesText}</span>
        </div>

        {!current ? (
          <div className="card accent center">
            <h2>按这些条件，没有一款是完全合适的</h2>
            <p className="sub" style={{ marginBottom: 16 }}>
              8 款的硬条件都对不上。回去放宽一条通常最稳——把时长或者「人手一台手机」调一下就有解；
              要是你们就想硬开，点下面的「看看全部 {GAMES.length} 款游戏」，挑一个照样能开，只是会有点别扭。
            </p>
            <button type="button" className="btn primary" onClick={editConditions}>
              回去改条件
            </button>
          </div>
        ) : (
          <>
            <div className="rec" style={{ ['--c' as any]: current.game.color }}>
              <div className="top">
                <div className="row between">
                  <div className="emoji">{current.game.emoji}</div>
                  <span className="chip hot">
                    {safeRank === 0 ? '最佳匹配' : `第 ${safeRank + 1} 推荐`}
                  </span>
                </div>
                <div className="name">{current.game.name}</div>
                <div className="latin">{current.game.latin}</div>
              </div>
              <div className="body">
                <div className="match">
                  <div className="ring" style={{ ['--p' as any]: current.rec.percent }}>
                    <i>{current.rec.percent}</i>
                  </div>
                  <div>
                    <div style={{ fontWeight: 800 }}>{current.game.tagline}</div>
                    <div className="dim">
                      {current.game.minPlayers}–{current.game.maxPlayers} 人 ·{' '}
                      {current.game.minutes[0]}–{current.game.minutes[1]} 分钟 ·{' '}
                      {current.game.needs.phones === 'each'
                        ? '人手一机'
                        : current.game.needs.phones === 'none'
                          ? '不用手机'
                          : '一台设备'}
                    </div>
                  </div>
                </div>

                <p className="sub" style={{ marginBottom: 14 }}>
                  {current.game.desc}
                </p>

                {err && <div className="banner err">{err}</div>}

                <div className="result-actions">
                  <button
                    type="button"
                    className="btn go big"
                    disabled={busy}
                    onClick={() => void accept(current.game.id)}
                  >
                    {busy ? (
                      <>
                        <span className="spin" /> 开房间中…
                      </>
                    ) : (
                      '就这个，开房间'
                    )}
                  </button>
                  <button
                    type="button"
                    className="btn big"
                    disabled={busy || shown.length <= 1}
                    onClick={() => setRank((r) => (r + 1) % shown.length)}
                  >
                    {shown.length <= 1
                      ? '只有这一个候选'
                      : safeRank >= shown.length - 1
                        ? '回到第一个候选'
                        : '不满意，换一个'}
                  </button>
                </div>
                <p className="notice center" style={{ marginTop: 12 }}>
                  按匹配度排的前 {shown.length} 个，换一个不会改变你填的条件。
                </p>
              </div>
            </div>

            <section className="panel" style={{ marginTop: 16 }} aria-label="为什么推荐它">
              <div className="h">为什么推它</div>
              <ul className="reasons">
                {current.rec.why.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
                {current.rec.watch.map((w, i) => (
                  <li className="warn" key={`w${i}`}>
                    注意：{w}
                  </li>
                ))}
              </ul>
            </section>

            <section className="panel" style={{ marginTop: 12 }} aria-label="怎么玩">
              <div className="h">怎么玩</div>
              <ol className="howto">
                {current.game.howTo.map((h, i) => (
                  <li key={i}>{h}</li>
                ))}
              </ol>
            </section>
          </>
        )}

        <button
          type="button"
          className="btn big"
          style={{ marginTop: 16 }}
          onClick={() => setScreen('games')}
        >
          看看全部 {GAMES.length} 款游戏 →
        </button>
      </div>
    </div>
  )
}

function Step(props: { no: number; title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="step" aria-labelledby={`step-title-${props.no}`}>
      <p className="step-index">STEP {String(props.no + 1).padStart(2, '0')}</p>
      <h1 className="step-title" id={`step-title-${props.no}`}>
        {props.title}
      </h1>
      {props.hint && <p className="step-lead">{props.hint}</p>}
      {props.children}
    </section>
  )
}

function Choice(props: {
  label: string
  hint?: string
  on: boolean
  multi?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      role={props.multi ? 'checkbox' : 'radio'}
      aria-checked={props.on}
      className={`choice-row ${props.on ? 'on' : ''}`}
      onClick={props.onClick}
    >
      <span className="choice-copy">
        <b>{props.label}</b>
        {props.hint && <span>{props.hint}</span>}
      </span>
      <span className="choice-tick" aria-hidden="true">
        {props.on && <Check />}
      </span>
    </button>
  )
}

function SwitchRow(props: {
  label: string
  hint: string
  on: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={props.on}
      className={`switch-row ${props.on ? 'on' : ''}`}
      onClick={props.onClick}
    >
      <span className="choice-copy">
        <b>{props.label}</b>
        <span>{props.hint}</span>
      </span>
      <span className="switch" aria-hidden="true" />
    </button>
  )
}

function Check() {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M3.4 8.4l3.1 3.1 6.1-6.9"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function ChevronLeft() {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" fill="none" aria-hidden="true">
      <path
        d="M10 3.5L5.5 8l4.5 4.5"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}
