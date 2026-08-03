import { assertRejects } from '@std/assert'
import { stub } from '@std/testing/mock'
import ZanixAdminHub from '../../../mod.ts'

// Its own file — same one-shot-registration constraint as `start.test.ts`/`start-no-routes.test.ts`:
// only one real `ZanixAdminHub.start()` call (the one that's allowed to actually complete) per file.

stub(console, 'info')
stub(console, 'error')
stub(console, 'warn')

Deno.test({
  sanitizeOps: false,
  sanitizeResources: false,
  name:
    'ZanixAdminHub.start() called again before a first, still-in-flight call resolves throws instead of racing',
  fn: async () => {
    // Deliberately not awaited — mirrors `@zanix/core`'s own `start-overlap-guard.test.ts`: a
    // second overlapping call's synchronous prefix could otherwise run before the first call
    // resumed past its own first `await`, racing the same process-wide route/DI/discovery
    // registries `bootstrapServers` mutates.
    const first = ZanixAdminHub.start()

    await assertRejects(
      () => ZanixAdminHub.start(),
      Error,
      'was called again before a previous call in this process finished',
    )

    // The first call, unaffected by the rejected second one, must still complete normally.
    await first

    await ZanixAdminHub.stop()
  },
})
