import type { HostFunction } from './interpreter.ts'

/**
 * The only door between a program and the outside world.
 *
 * `use turtle` looks up `modules.turtle`. Each field is a function the
 * interpreter calls. This file, and the interpreter, never see a canvas,
 * a DOM node, or a turtle. The host closes over those itself.
 */
export interface Host {
  modules: Readonly<Record<string, Readonly<Record<string, HostFunction>>>>
}
