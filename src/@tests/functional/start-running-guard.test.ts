import { assertRejects } from '@std/assert'
import { stub } from '@std/testing/mock'
import ZanixAdminHub from '../../../mod.ts'

// Its own file — same one-shot-registration constraint as `start-overlap-guard.test.ts`.

stub(console, 'info')
stub(console, 'warn')
stub(console, 'error')

Deno.test({
  sanitizeOps: false,
  sanitizeResources: false,
  name:
    'ZanixAdminHub.start() called again after a previous call already finished (no stop() in between) throws — and works again once stop() releases it',
  fn: async () => {
    await ZanixAdminHub.start()

    // Fully sequential — the first call already resolved, unlike `start-overlap-guard.test.ts`'s
    // still-in-flight scenario. `isRunning`, not `isStarting`, is what catches this one.
    await assertRejects(
      () => ZanixAdminHub.start(),
      Error,
      'is still running',
    )

    await ZanixAdminHub.stop()

    // The guard was released by `stop()` — a fresh `start()` must succeed again, not stay
    // permanently blocked by the earlier rejection.
    await ZanixAdminHub.start()

    await ZanixAdminHub.stop()
  },
})
