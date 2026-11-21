import { describe, expect, it } from 'vitest'
import { initialMascot, reduceMascot } from '../src/playground/mascot.ts'

describe('Pipkin', () => {
  it('bounces into typing, then thinks when the keys stop', () => {
    const typed = reduceMascot(initialMascot(0), { type: 'key', now: 10 })
    expect(typed.mood).toBe('typing')
    expect(reduceMascot(typed, { type: 'settle', now: 800 }).mood).toBe('thinking')
  })

  it('tangles on an error and hops happy once it compiles', () => {
    const broken = reduceMascot(initialMascot(0), { type: 'error', now: 5 })
    expect(broken.mood).toBe('tangled')
    expect(broken.hadError).toBe(true)
    const fixed = reduceMascot(broken, { type: 'compiled', now: 9, bubbles: true })
    expect(fixed.mood).toBe('happy')
    expect(fixed.relief).toBe(true)
    expect(fixed.hadError).toBe(false)
    expect(fixed.bubble).toBe('That compiled.')
  })

  it('keeps a clean compile quiet when bubbles are off', () => {
    const next = reduceMascot(initialMascot(0), { type: 'compiled', now: 4, bubbles: false })
    expect(next.mood).toBe('happy')
    expect(next.bubble).toBeNull()
  })

  it('reacts to play, rewind, and a fast slider', () => {
    const start = initialMascot(0)
    expect(reduceMascot(start, { type: 'score', now: 1 }).mood).toBe('happy')
    expect(reduceMascot(start, { type: 'over', now: 1 }).mood).toBe('surprised')
    expect(reduceMascot(start, { type: 'win', now: 1 }).mood).toBe('cheer')
    expect(reduceMascot(start, { type: 'scrub', now: 1, active: true }).mood).toBe('rewind')
    expect(reduceMascot(start, { type: 'tweak', now: 1, fast: true }).mood).toBe('dizzy')
    expect(reduceMascot(start, { type: 'poke', now: 1 }).mood).toBe('giggle')
    expect(reduceMascot(start, { type: 'react', now: 1, mood: 'cheer' }).mood).toBe('cheer')
    expect(reduceMascot(start, { type: 'react', now: 1, mood: 'nope' }).mood).toBe('idle')
  })

  it('falls asleep after a minute and wakes on a key', () => {
    const sleepy = reduceMascot(initialMascot(0), { type: 'idle-check', now: 61_000 })
    expect(sleepy.mood).toBe('sleepy')
    const asleep = reduceMascot(initialMascot(0), { type: 'idle-check', now: 70_000 })
    expect(asleep.mood).toBe('asleep')
    expect(reduceMascot(asleep, { type: 'key', now: 71_000 }).mood).toBe('typing')
  })

  it('says one hint, then waits', () => {
    const first = reduceMascot(initialMascot(0), { type: 'hint', now: 1_000, text: 'Cmd+K opens the command bar.', bubbles: true })
    expect(first.bubble).toBe('Cmd+K opens the command bar.')
    const second = reduceMascot(first, { type: 'hint', now: 2_000, text: 'Again', bubbles: true })
    expect(second.bubble).toBe(first.bubble)
    const later = reduceMascot(first, { type: 'hint', now: 200_000, text: 'Alt-click a number.', bubbles: true })
    expect(later.bubble).toBe('Alt-click a number.')
  })
})
