import { assert, assertEquals } from '@std/assert'
import { stub } from '@std/testing/mock'
import { activateApps, getLocalOperation } from '@zanix/app/runtime'
import { TriggersAdminService, type TriggersModelAttrs } from '@zanix/database'
import { TemplatesAdminService, type ZanixTemplateAttrs } from '@zanix/notifications'
import { defineLocalAdminApp, getLocalAdminSubApps } from 'modules/local-admin-app.ts'
import { ADMIN_TEMPLATES_APPLICATION, ADMIN_TRIGGERS_APPLICATION } from 'utils/constants.ts'

// Same one-shot-registration constraint every other functional test in this suite already
// documents (see `start-no-routes.test.ts`'s own comment): this must be the first thing that runs
// in this process — `TRIGGERS_MODEL_NAME=false` and no `TEMPLATES_MODEL_ENV` set means
// `defineLocalAdminApp()`'s own `setup()` (which still runs as part of `activateApps`) registers
// ONLY the always-on `service-exchange` controller, never `/admin/triggers`/`/admin/templates` —
// this test is about `operations`, not the REST surface, and must never collide with whatever
// those routes' own dedicated test files already registered elsewhere in the same suite.
Deno.env.set('TRIGGERS_MODEL_NAME', 'false')
stub(console, 'info')

await activateApps([defineLocalAdminApp(), ...getLocalAdminSubApps()])

// Triggers'/Templates' `operations` now live on their own physically-separate sub-apps
// (`ADMIN_TRIGGERS_APPLICATION`/`ADMIN_TEMPLATES_APPLICATION`), not on `defineLocalAdminApp`
// itself — see `local-admin-app.ts`'s own doc for why.
const TRIGGERS_OPERATIONS = new Set([
  'listTriggers',
  'getTrigger',
  'createTrigger',
  'updateTrigger',
  'removeTrigger',
])

function getOperation(name: string) {
  const application = TRIGGERS_OPERATIONS.has(name)
    ? ADMIN_TRIGGERS_APPLICATION
    : ADMIN_TEMPLATES_APPLICATION
  const found = getLocalOperation(application, name)
  assert(
    found,
    `operation "${name}" should be registered under "${application}"`,
  )
  return found
}

Deno.test('local admin app: listTriggers forwards to TriggersAdminService.list()', async () => {
  const listStub = stub(
    TriggersAdminService.prototype,
    'list',
    () => Promise.resolve(['a'] as unknown as TriggersModelAttrs[]),
  )
  try {
    const { handler, ctx } = getOperation('listTriggers')
    const result = await handler(undefined, ctx)
    assertEquals(result, ['a'])
  } finally {
    listStub.restore()
  }
})

Deno.test(
  'local admin app: getTrigger forwards {model} to TriggersAdminService.get()',
  async () => {
    const calls: unknown[][] = []
    const getStub = stub(
      TriggersAdminService.prototype,
      'get',
      (
        ...args: unknown[]
      ) => (calls.push(args), Promise.resolve({ model: 'Invoice' } as TriggersModelAttrs)),
    )
    try {
      const { handler, ctx } = getOperation('getTrigger')
      const result = await handler({ model: 'Invoice' }, ctx)
      assertEquals(result, { model: 'Invoice' })
      assertEquals(calls, [['Invoice']])
    } finally {
      getStub.restore()
    }
  },
)

Deno.test(
  'local admin app: createTrigger forwards {model,active,triggers} to TriggersAdminService.create()',
  async () => {
    const calls: unknown[][] = []
    const createStub = stub(
      TriggersAdminService.prototype,
      'create',
      (
        ...args: unknown[]
      ) => (calls.push(args), Promise.resolve({ model: 'Invoice' } as TriggersModelAttrs)),
    )
    try {
      const { handler, ctx } = getOperation('createTrigger')
      const payload = { model: 'Invoice', active: true, triggers: { pre: {} } }
      await handler(payload, ctx)
      assertEquals(calls, [[payload]])
    } finally {
      createStub.restore()
    }
  },
)

Deno.test(
  'local admin app: updateTrigger forwards {model, active, triggers} to TriggersAdminService.update()',
  async () => {
    const calls: unknown[][] = []
    const updateStub = stub(
      TriggersAdminService.prototype,
      'update',
      (
        ...args: unknown[]
      ) => (calls.push(args),
        Promise.resolve({ model: 'Invoice', active: false } as TriggersModelAttrs)),
    )
    try {
      const { handler, ctx } = getOperation('updateTrigger')
      const result = await handler({ model: 'Invoice', active: false }, ctx)
      assertEquals(result, { model: 'Invoice', active: false })
      assertEquals(calls, [['Invoice', { active: false, triggers: undefined }]])
    } finally {
      updateStub.restore()
    }
  },
)

Deno.test('local admin app: removeTrigger forwards {model}, reports deleted', async () => {
  const calls: unknown[][] = []
  const removeStub = stub(
    TriggersAdminService.prototype,
    'remove',
    (...args: unknown[]) => (calls.push(args), Promise.resolve()),
  )
  try {
    const { handler, ctx } = getOperation('removeTrigger')
    const result = await handler({ model: 'Invoice' }, ctx)
    assertEquals(result, { deleted: 'Invoice' })
    assertEquals(calls, [['Invoice']])
  } finally {
    removeStub.restore()
  }
})

Deno.test(
  'local admin app: listTemplates forwards to TemplatesAdminService.list()',
  async () => {
    const listStub = stub(
      TemplatesAdminService.prototype,
      'list',
      () => Promise.resolve(['t'] as unknown as ZanixTemplateAttrs[]),
    )
    try {
      const { handler, ctx } = getOperation('listTemplates')
      const result = await handler(undefined, ctx)
      assertEquals(result, ['t'])
    } finally {
      listStub.restore()
    }
  },
)

Deno.test(
  'local admin app: createTemplate forwards the input + an operation audit identity, ' +
    'never a real user session (operations have none)',
  async () => {
    const calls: unknown[][] = []
    const createStub = stub(
      TemplatesAdminService.prototype,
      'create',
      (
        ...args: unknown[]
      ) => (calls.push(args), Promise.resolve({ name: 'welcome' } as ZanixTemplateAttrs)),
    )
    try {
      const { handler, ctx } = getOperation('createTemplate')
      const payload = {
        channel: 'email' as const,
        name: 'welcome',
        hbs: '<p>hi</p>',
      }
      await handler(payload, ctx)
      assertEquals(calls, [[payload, 'zanix-operation']])
    } finally {
      createStub.restore()
    }
  },
)

Deno.test(
  'local admin app: getTemplate forwards {channel, name} to TemplatesAdminService.get()',
  async () => {
    const calls: unknown[][] = []
    const getStub = stub(
      TemplatesAdminService.prototype,
      'get',
      (
        ...args: unknown[]
      ) => (calls.push(args),
        Promise.resolve({ channel: 'email', name: 'welcome' } as ZanixTemplateAttrs)),
    )
    try {
      const { handler, ctx } = getOperation('getTemplate')
      const result = await handler({ channel: 'email', name: 'welcome' }, ctx)
      assertEquals(result, { channel: 'email', name: 'welcome' })
      assertEquals(calls, [['email', 'welcome']])
    } finally {
      getStub.restore()
    }
  },
)

Deno.test(
  'local admin app: updateTemplate forwards {channel, name, ...changes} + an operation audit identity',
  async () => {
    const calls: unknown[][] = []
    const updateStub = stub(
      TemplatesAdminService.prototype,
      'update',
      (
        ...args: unknown[]
      ) => (calls.push(args),
        Promise.resolve<ZanixTemplateAttrs>({
          channel: 'email',
          name: 'welcome',
          hbs: '<p>new</p>',
        } as ZanixTemplateAttrs)),
    )
    try {
      const { handler, ctx } = getOperation('updateTemplate')
      const payload = { channel: 'email' as const, name: 'welcome', hbs: '<p>new</p>' }
      await handler(payload, ctx)
      assertEquals(calls, [[
        'email',
        'welcome',
        { hbs: '<p>new</p>' },
        'zanix-operation',
      ]])
    } finally {
      updateStub.restore()
    }
  },
)

Deno.test(
  'local admin app: removeTemplate forwards {channel, name} + an operation audit identity, reports deactivated',
  async () => {
    const calls: unknown[][] = []
    const removeStub = stub(
      TemplatesAdminService.prototype,
      'remove',
      (...args: unknown[]) => (calls.push(args), Promise.resolve()),
    )
    try {
      const { handler, ctx } = getOperation('removeTemplate')
      const result = await handler({ channel: 'email', name: 'welcome' }, ctx)
      assertEquals(result, { deactivated: 'welcome' })
      assertEquals(calls, [['email', 'welcome', 'zanix-operation']])
    } finally {
      removeStub.restore()
    }
  },
)

Deno.test('local admin app: mutating operations never carry `mcp` — only list/get do', () => {
  for (const name of ['createTrigger', 'updateTrigger', 'removeTrigger']) {
    assertEquals(
      getOperation(name).mcp,
      null,
      `${name} must not be exposed via mcp`,
    )
  }
  for (const name of ['listTriggers', 'getTrigger']) {
    assert(getOperation(name).mcp, `${name} must be exposed via mcp`)
  }
})
