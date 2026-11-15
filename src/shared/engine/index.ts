import type { GameEngine } from './contract'
import { bombEngine } from './bomb'
import { mimeEngine } from './mime'
import { neverEngine } from './never'
import { sevenEngine } from './seven'
import { soupEngine } from './soup'
import { spyEngine } from './spy'
import { storyEngine } from './story'
import { twosEngine } from './twos'
import { werewolfEngine } from './werewolf'

export const ENGINES: Record<string, GameEngine> = {
  spy: spyEngine,
  twos: twosEngine,
  soup: soupEngine,
  bomb: bombEngine,
  seven: sevenEngine,
  story: storyEngine,
  never: neverEngine,
  mime: mimeEngine,
  werewolf: werewolfEngine,
}

export const engineFor = (gameId: string): GameEngine | null => ENGINES[gameId] ?? null

export type { GameEngine } from './contract'
