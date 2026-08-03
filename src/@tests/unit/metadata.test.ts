import { assertEquals } from 'jsr:@std/assert@^1.0.15'
import type { HandlerContext } from '@zanix/server'
import { ProgramModule } from '@zanix/server'
import { createTemplatesDiscoveryGuard } from 'modules/metadata.ts'

console.error = () => {}

/** Minimal fake context — just enough for `jwtValidationGuard`'s own no-token early exit to run. */
function fakeContext(): HandlerContext & {
  // deno-lint-ignore no-explicit-any
  providers: any
  // deno-lint-ignore no-explicit-any
  connectors: any
  // deno-lint-ignore no-explicit-any
  interactors: any
} {
  return {
    req: { headers: { get: () => null } },
    id: 'req-1',
    providers: ProgramModule.providers,
    connectors: ProgramModule.connectors,
    // deno-lint-ignore no-explicit-any
    interactors: null as any,
    locals: {},
    cookies: {},
    // deno-lint-ignore no-explicit-any
  } as any
}

Deno.test('createTemplatesDiscoveryGuard: returns a callable guard function', () => {
  const guard = createTemplatesDiscoveryGuard()
  assertEquals(typeof guard, 'function')
})

Deno.test(
  'createTemplatesDiscoveryGuard: rejects an unauthenticated request — same as ADMIN_ROLE/ADMIN_TEMPLATES_ROLE-gated CRUD',
  async () => {
    const guard = createTemplatesDiscoveryGuard()
    const result = await guard(fakeContext())
    const body = await result.response?.json()
    assertEquals(result.response?.status, 401)
    assertEquals(body.status.code, 'UNAUTHORIZED')
  },
)
