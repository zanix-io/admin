import { assert, assertEquals } from '@std/assert'
import { assertSpyCalls, stub } from '@std/testing/mock'
import { WebServerManager } from '@zanix/server'
import ZanixAdminHub from '../../../mod.ts'

/**
 * Real `Deno.addSignalListener`/`Deno.removeSignalListener`/`Deno.exit` calls are stubbed the SAME
 * way `@zanix/core`'s own `start-shutdown-signal.test.ts` stubs them — capturing the real handler
 * `start()` registers, invoking it directly instead of sending an actual OS signal.
 */
function stubSignals() {
  const handlers = new Map<string, () => void | Promise<void>>()
  const removed: string[] = []
  const addSignalStub = stub(
    Deno,
    'addSignalListener',
    ((signal: Deno.Signal, handler: () => void) => {
      handlers.set(signal, handler)
    }) as never,
  )
  const removeSignalStub = stub(
    Deno,
    'removeSignalListener',
    ((signal: Deno.Signal) => {
      removed.push(signal)
    }) as never,
  )
  const exitStub = stub(Deno, 'exit', (() => {}) as never)

  return {
    handlers,
    removed,
    exitStub,
    restore: () => {
      addSignalStub.restore()
      removeSignalStub.restore()
      exitStub.restore()
    },
  }
}

Deno.test({
  sanitizeOps: false,
  sanitizeResources: false,
  name: 'SIGTERM triggers ZanixAdminHub.stop() and exits cleanly, without a real Deno.exit',
  fn: async () => {
    const consoleInfo = stub(console, 'info')
    const consoleWarn = stub(console, 'warn')
    const signals = stubSignals()

    try {
      await ZanixAdminHub.start()

      const sigterm = signals.handlers.get('SIGTERM')
      assert(
        sigterm,
        'SIGTERM listener should have been registered by start()',
      )
      assert(
        signals.handlers.get('SIGINT'),
        'SIGINT listener should have been registered too',
      )

      await sigterm()

      assert(
        signals.removed.includes('SIGINT') &&
          signals.removed.includes('SIGTERM'),
      )
      assertSpyCalls(signals.exitStub, 1)
      assertEquals(signals.exitStub.calls[0].args[0], 0)
    } finally {
      signals.restore()
      consoleInfo.restore()
      consoleWarn.restore()
    }
  },
})

Deno.test({
  sanitizeOps: false,
  sanitizeResources: false,
  name:
    'ZanixAdminHub.stop() called twice in a row does not throw removing an already-removed listener',
  fn: async () => {
    const consoleInfo = stub(console, 'info')
    const consoleWarn = stub(console, 'warn')
    const signals = stubSignals()

    try {
      await ZanixAdminHub.start()

      await ZanixAdminHub.stop()
      await ZanixAdminHub.stop() // must not throw

      // The second call found no listener to remove — only the first call's removal is recorded.
      assertEquals(signals.removed.filter((s) => s === 'SIGTERM').length, 1)
    } finally {
      signals.restore()
      consoleInfo.restore()
      consoleWarn.restore()
    }
  },
})

Deno.test({
  sanitizeOps: false,
  sanitizeResources: false,
  name:
    'ZanixAdminHub.stop() failing during a signal-triggered shutdown logs the error and does NOT force-exit the process',
  fn: async () => {
    const consoleInfo = stub(console, 'info')
    const consoleWarn = stub(console, 'warn')
    const consoleError = stub(console, 'error')
    const signals = stubSignals()

    try {
      await ZanixAdminHub.start()

      // `webServerManager` itself is `Object.freeze`d (a module-level singleton) — `stop` isn't one
      // of its own properties, it lives on the class prototype, which isn't frozen, so it's stubbed
      // there instead. Same technique `@zanix/core`'s own equivalent test uses.
      const stopStub = stub(
        WebServerManager.prototype,
        'stop',
        () => Promise.reject(new Error('boom')),
      )

      try {
        const sigterm = signals.handlers.get('SIGTERM')
        assert(sigterm)
        await sigterm()

        // Unlike `@zanix/core`'s own equivalent test — this package may share a process with an
        // unrelated, genuinely independent entrypoint (see `start()`'s own doc), so a `stop()`
        // failure here must never call `Deno.exit()` at all, clean or otherwise.
        assertSpyCalls(signals.exitStub, 0)
        assertSpyCalls(consoleError, 1)
      } finally {
        stopStub.restore()
      }
    } finally {
      signals.restore()
      consoleInfo.restore()
      consoleWarn.restore()
      consoleError.restore()
    }
  },
})
