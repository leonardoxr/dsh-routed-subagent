import { describe, expect, it, vi } from 'vitest'

import type { SubagentRun } from '@deepseek-ai/dsh-subagent'
import { settleBackgroundStart } from '../src/index.js'

function completedRun(): SubagentRun {
  return {
    id: 'run-1',
    result: Promise.resolve({ stopReason: 'completed', output: [{ type: 'text', text: 'ok' }] }),
    dispose: vi.fn(),
  } as unknown as SubagentRun
}

describe('background job settlement', () => {
  it('returns a terminal outcome instead of resolving undefined', async () => {
    const run = completedRun()
    await expect(settleBackgroundStart(Promise.resolve(run), new AbortController().signal))
      .resolves.toMatchObject({ status: 'completed' })
    expect(run.dispose).toHaveBeenCalledOnce()
  })

  it('maps startup failure and cancellation without rejecting the job producer', async () => {
    const failed = settleBackgroundStart(Promise.reject(new Error('start failed')), new AbortController().signal)
    await expect(failed).resolves.toMatchObject({ status: 'failed', detail: expect.stringContaining('start failed') })

    const controller = new AbortController()
    controller.abort()
    await expect(settleBackgroundStart(Promise.reject(new Error('aborted')), controller.signal))
      .resolves.toEqual({ status: 'killed' })
  })
})
