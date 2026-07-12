import { describe, expect, it, vi } from 'vitest'
import { LocalEventBus } from './events'

describe('LocalEventBus', () => {
  it('delivers published events to subscribers until they unsubscribe', () => {
    const bus = new LocalEventBus()
    const heard = vi.fn<(event: string) => void>()
    const unsubscribe = bus.subscribe(heard)
    bus.publish('request.created')
    unsubscribe()
    bus.publish('request.deleted')
    expect(heard).toHaveBeenCalledExactlyOnceWith('request.created')
  })

  it('notifies close listeners once so streams can end and reconnect', () => {
    const bus = new LocalEventBus()
    const closed = vi.fn<() => void>()
    bus.onClose(closed)
    bus.close()
    bus.close()
    expect(closed).toHaveBeenCalledOnce()
  })
})
