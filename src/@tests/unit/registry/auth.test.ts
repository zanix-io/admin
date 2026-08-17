import { assertEquals } from '@std/assert'
import { assertSpyCalls, spy } from '@std/testing/mock'
import { generateRSAKeys } from '@zanix/helpers'
import { createServiceRegistryAuthHeaders } from 'modules/registry/auth.ts'

console.error = () => {}

const jsonResponse = (body: unknown) =>
  Promise.resolve(
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }),
  )

Deno.test({
  name:
    "createServiceRegistryAuthHeaders: exchanges against {adminBaseUrl}/admin/service-token, never the target's own business-server prefix",
  fn: async () => {
    const { privateKey } = await generateRSAKeys()
    let calledUrl: string | undefined

    const mockFetch = spy((url: string) => {
      calledUrl = url
      return jsonResponse({
        accessToken: 'tok',
        expiresIn: 1800,
        serviceId: 'billing',
      })
    })
    globalThis.fetch = mockFetch as unknown as typeof fetch

    const authHeaders = createServiceRegistryAuthHeaders({
      serviceId: 'zanix-admin-hub',
      privateKey: btoa(privateKey),
    })
    const headers = await authHeaders({
      serviceId: 'billing',
      // A `globalPrefix: 'auth'` business server prefix must never leak into the exchange URL —
      // the embedded admin's own service-token route is fixed, independent of it.
      adminBaseUrl: 'http://localhost:9091/server-id-rest',
    })

    assertEquals(
      calledUrl,
      'http://localhost:9091/server-id-rest/admin/service-token',
    )
    assertEquals(headers, { 'X-Znx-Authorization': 'Bearer tok' })
    assertSpyCalls(mockFetch, 1)
  },
})

Deno.test({
  name:
    'createServiceRegistryAuthHeaders: two different ServiceRegistryEntry targets get independent tokens',
  fn: async () => {
    const { privateKey } = await generateRSAKeys()
    let call = 0
    globalThis.fetch = (() => {
      call++
      return jsonResponse({
        accessToken: `tok-${call}`,
        expiresIn: 1800,
        serviceId: 'x',
      })
    }) as unknown as typeof fetch

    const authHeaders = createServiceRegistryAuthHeaders({
      serviceId: 'zanix-admin-hub',
      privateKey: btoa(privateKey),
    })
    const billing = await authHeaders({
      serviceId: 'billing',
      adminBaseUrl: 'http://billing.internal',
    })
    const inventory = await authHeaders({
      serviceId: 'inventory',
      adminBaseUrl: 'http://inventory.internal',
    })

    assertEquals(billing, { 'X-Znx-Authorization': 'Bearer tok-1' })
    assertEquals(inventory, { 'X-Znx-Authorization': 'Bearer tok-2' })
  },
})
