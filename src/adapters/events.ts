import { EventEmitter } from 'node:events'
import type { AppEvent, EventBus } from '../core/types'

export class LocalEventBus implements EventBus {
  private emitter = new EventEmitter()

  constructor() {
    this.emitter.setMaxListeners(100)
  }

  publish(event: AppEvent) {
    this.emitter.emit('change', event)
  }

  subscribe(listener: (event: AppEvent) => void) {
    this.emitter.on('change', listener)
    return () => this.emitter.off('change', listener)
  }

  /** Signals long-lived subscribers (SSE streams) to end; they reconnect to the replacement bus. */
  onClose(listener: () => void) {
    this.emitter.once('close', listener)
    return () => this.emitter.off('close', listener)
  }

  close() {
    this.emitter.emit('close')
  }
}
