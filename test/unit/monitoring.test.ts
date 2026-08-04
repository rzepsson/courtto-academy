import { afterEach, describe, expect, it } from 'vitest'
import {
  captureError,
  captureMessage,
  clearMonitoringSink,
  setMonitoringSink,
  type MonitoringEvent
} from '../../server/utils/monitoring'

function record(): MonitoringEvent[] {
  const events: MonitoringEvent[] = []
  setMonitoringSink({
    name: 'recording',
    capture(event) {
      events.push(event)
    }
  })
  return events
}

afterEach(() => {
  clearMonitoringSink()
})

describe('captureError', () => {
  it('reports an Error with its name, message and context', () => {
    const events = record()
    captureError(new TypeError('boom'), { scope: 'mail.send', organizationId: 'org_1' })

    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      level: 'error',
      message: 'boom',
      error: { name: 'TypeError', message: 'boom' },
      context: { scope: 'mail.send', organizationId: 'org_1' }
    })
    expect(typeof events[0]!.timestamp).toBe('string')
  })

  it('normalizes a non-Error throw', () => {
    const events = record()
    captureError('just a string')
    expect(events[0]!.error).toMatchObject({ name: 'NonError', message: 'just a string' })
  })

  it('never throws, even when the sink itself throws', () => {
    setMonitoringSink({
      name: 'broken',
      capture() {
        throw new Error('sink is down')
      }
    })
    expect(() => captureError(new Error('x'))).not.toThrow()
  })
})

describe('captureMessage', () => {
  it('records the given level and message', () => {
    const events = record()
    captureMessage('warning', 'heads up', { scope: 'sweep' })
    expect(events[0]).toMatchObject({ level: 'warning', message: 'heads up', context: { scope: 'sweep' } })
    expect(events[0]!.error).toBeUndefined()
  })
})
