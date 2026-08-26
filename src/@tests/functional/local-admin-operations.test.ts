import { assert, assertEquals } from '@std/assert'
import { stub } from '@std/testing/mock'
import { activateApps, getLocalOperation } from '@zanix/app/runtime'
import {
  DLQ_MODEL_ENV,
  DlqAdminService,
  type DlqEntryAttrs,
  type DlqPaginatedResult,
} from '@zanix/datamaster/dlq'
import type { TriggersModelAttrs } from '@zanix/datamaster/database'
import { TriggersAdminService } from '@zanix/datamaster/triggers-api'
import {
  TEMPLATES_BACKEND_ENV,
  TEMPLATES_MODEL_ENV,
  TemplatesAdminService,
  type ZanixTemplateAttrs,
} from '@zanix/notifications'
import { getLocalAdminSubApps } from 'modules/local-admin-app.ts'
import {
  ADMIN_DLQ_APPLICATION,
  ADMIN_TEMPLATES_APPLICATION,
  ADMIN_TRIGGERS_APPLICATION,
} from 'utils/constants.ts'

// Same one-shot-registration constraint every other functional test in this suite already
// documents (see `start-no-routes.test.ts`'s own comment): env vars affecting `getLocalAdminSubApps()`
// must be set before its first call in this process. Unlike before `getLocalAdminSubApps()` gated
// its sub-apps by the exact same signals `defineAdminMetadata()` uses (see `local-admin-app.ts`'s
// own doc), so exercising every operation below requires all three resources actually enabled —
// triggers stays on by default (no override needed), templates/dlq need their opt-in env vars set.
// This test activates `getLocalAdminSubApps()` alone, deliberately never `defineLocalAdminApp()`
// (which would additionally register real `/admin/*` REST routes via `defineAdminMetadata()`) —
// each sub-app resolves its own `TriggersAdminService`/`TemplatesAdminService`/`DlqAdminService`
// through `@zanix/server`'s DI, scoped by ITS OWN Application name (`admin-triggers`/
// `admin-templates`/`admin-dlq`), entirely independent of whatever Application the REST
// controllers register under — so this file never needs a live REST surface to test `operations`,
// and never risks colliding with the dedicated REST test files elsewhere in this suite.
Deno.env.set(TEMPLATES_BACKEND_ENV, 'local')
Deno.env.set(TEMPLATES_MODEL_ENV, 'zanix-templates-local-ops-test')
Deno.env.set(DLQ_MODEL_ENV, 'zanix-dlq-local-ops-test')
stub(console, 'info')

await activateApps(getLocalAdminSubApps())

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
// DLQ's own `operations` live on their own sub-app too (`ADMIN_DLQ_APPLICATION`,
// `dlq/local-dlq-app.ts`) — same reasoning as Triggers/Templates.
const DLQ_OPERATIONS = new Set([
  'listDlqEntries',
  'getDlqEntry',
  'pushDlqEntry',
  'requeueDlqEntry',
  'discardDlqEntry',
  'removeDlqEntry',
])

function getOperation(name: string) {
  const application = TRIGGERS_OPERATIONS.has(name)
    ? ADMIN_TRIGGERS_APPLICATION
    : DLQ_OPERATIONS.has(name)
    ? ADMIN_DLQ_APPLICATION
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

Deno.test(
  'local admin app: listDlqEntries forwards {options} to DlqAdminService.list()',
  async () => {
    const calls: unknown[][] = []
    const listStub = stub(
      DlqAdminService.prototype,
      'list',
      (...args: unknown[]) => (
        calls.push(args),
          Promise.resolve(
            { docs: ['a'] } as unknown as DlqPaginatedResult,
          )
      ),
    )
    try {
      const { handler, ctx } = getOperation('listDlqEntries')
      const result = await handler({ status: 'pending' }, ctx)
      assertEquals(result, { docs: ['a'] })
      assertEquals(calls, [[{ status: 'pending' }]])
    } finally {
      listStub.restore()
    }
  },
)

Deno.test('local admin app: getDlqEntry forwards {id} to DlqAdminService.get()', async () => {
  const calls: unknown[][] = []
  const getStub = stub(
    DlqAdminService.prototype,
    'get',
    (
      ...args: unknown[]
    ) => (calls.push(args), Promise.resolve({ id: 'entry-1' } as unknown as DlqEntryAttrs)),
  )
  try {
    const { handler, ctx } = getOperation('getDlqEntry')
    const result = await handler({ id: 'entry-1' }, ctx)
    assertEquals(result, { id: 'entry-1' })
    assertEquals(calls, [['entry-1']])
  } finally {
    getStub.restore()
  }
})

Deno.test(
  'local admin app: pushDlqEntry forwards the input to DlqAdminService.push()',
  async () => {
    const calls: unknown[][] = []
    const pushStub = stub(
      DlqAdminService.prototype,
      'push',
      (
        ...args: unknown[]
      ) => (calls.push(args), Promise.resolve({ id: 'entry-1' } as unknown as DlqEntryAttrs)),
    )
    try {
      const { handler, ctx } = getOperation('pushDlqEntry')
      const payload = { source: 'billing', reason: 'timeout', payload: { orderId: '1' } }
      await handler(payload, ctx)
      assertEquals(calls, [[payload]])
    } finally {
      pushStub.restore()
    }
  },
)

Deno.test(
  'local admin app: requeueDlqEntry forwards {id, ...options} to DlqAdminService.requeue()',
  async () => {
    const calls: unknown[][] = []
    const requeueStub = stub(
      DlqAdminService.prototype,
      'requeue',
      (
        ...args: unknown[]
      ) => (calls.push(args), Promise.resolve({ id: 'entry-1' } as unknown as DlqEntryAttrs)),
    )
    try {
      const { handler, ctx } = getOperation('requeueDlqEntry')
      const result = await handler({ id: 'entry-1', reason: 'manual retry' }, ctx)
      assertEquals(result, { id: 'entry-1' })
      assertEquals(calls, [['entry-1', { reason: 'manual retry' }]])
    } finally {
      requeueStub.restore()
    }
  },
)

Deno.test(
  'local admin app: discardDlqEntry forwards {id, ...options} to DlqAdminService.discard()',
  async () => {
    const calls: unknown[][] = []
    const discardStub = stub(
      DlqAdminService.prototype,
      'discard',
      (
        ...args: unknown[]
      ) => (calls.push(args), Promise.resolve({ id: 'entry-1' } as unknown as DlqEntryAttrs)),
    )
    try {
      const { handler, ctx } = getOperation('discardDlqEntry')
      const result = await handler({ id: 'entry-1', reason: 'unrecoverable' }, ctx)
      assertEquals(result, { id: 'entry-1' })
      assertEquals(calls, [['entry-1', { reason: 'unrecoverable' }]])
    } finally {
      discardStub.restore()
    }
  },
)

Deno.test('local admin app: removeDlqEntry forwards {id}, reports deleted', async () => {
  const calls: unknown[][] = []
  const removeStub = stub(
    DlqAdminService.prototype,
    'remove',
    (...args: unknown[]) => (calls.push(args), Promise.resolve()),
  )
  try {
    const { handler, ctx } = getOperation('removeDlqEntry')
    const result = await handler({ id: 'entry-1' }, ctx)
    assertEquals(result, { deleted: 'entry-1' })
    assertEquals(calls, [['entry-1']])
  } finally {
    removeStub.restore()
  }
})

Deno.test('local admin app: mutating operations never carry `mcp` — only list/get do', () => {
  for (
    const name of [
      'createTrigger',
      'updateTrigger',
      'removeTrigger',
      'pushDlqEntry',
      'requeueDlqEntry',
      'discardDlqEntry',
      'removeDlqEntry',
    ]
  ) {
    assertEquals(
      getOperation(name).mcp,
      null,
      `${name} must not be exposed via mcp`,
    )
  }
  for (const name of ['listTriggers', 'getTrigger', 'listDlqEntries', 'getDlqEntry']) {
    assert(getOperation(name).mcp, `${name} must be exposed via mcp`)
  }
})

Deno.test(
  "getLocalAdminSubApps(): composes a resource's sub-app if and only if defineAdminMetadata() " +
    "would also register that resource's REST controller — mirrors isTriggersResourceEnabled/" +
    'isTemplatesResourceEnabled/isDlqResourceEnabled exactly',
  () => {
    // Pure calls — `getLocalAdminSubApps()` re-reads the env on every invocation and returns plain
    // `ZanixAppDefinition`s, never touching `ProgramModule`/DI, so none of this needs `activateApps`
    // and can't affect (or be affected by) the module-level activation this file already did above.
    const triggersEnv = Deno.env.get('TRIGGERS_MODEL_NAME')
    const templatesBackendEnv = Deno.env.get(TEMPLATES_BACKEND_ENV)
    const templatesModelEnv = Deno.env.get(TEMPLATES_MODEL_ENV)
    const dlqModelEnv = Deno.env.get(DLQ_MODEL_ENV)
    try {
      Deno.env.set('TRIGGERS_MODEL_NAME', 'false')
      Deno.env.delete(TEMPLATES_BACKEND_ENV)
      Deno.env.delete(TEMPLATES_MODEL_ENV)
      Deno.env.delete(DLQ_MODEL_ENV)
      assertEquals(
        getLocalAdminSubApps().map((app) => app.definition.name),
        [],
        'nothing enabled: no sub-app composed',
      )

      Deno.env.delete('TRIGGERS_MODEL_NAME')
      assertEquals(
        getLocalAdminSubApps().map((app) => app.definition.name),
        [ADMIN_TRIGGERS_APPLICATION],
        'triggers is on by default: only its sub-app is composed',
      )

      Deno.env.set(TEMPLATES_BACKEND_ENV, 'local')
      Deno.env.set(TEMPLATES_MODEL_ENV, 'zanix-templates-gating-test')
      assertEquals(
        getLocalAdminSubApps().map((app) => app.definition.name),
        [ADMIN_TRIGGERS_APPLICATION, ADMIN_TEMPLATES_APPLICATION],
        'TEMPLATES_BACKEND=local: templates joins triggers',
      )

      Deno.env.set(DLQ_MODEL_ENV, 'zanix-dlq-gating-test')
      assertEquals(
        getLocalAdminSubApps().map((app) => app.definition.name),
        [ADMIN_TRIGGERS_APPLICATION, ADMIN_TEMPLATES_APPLICATION, ADMIN_DLQ_APPLICATION],
        'DLQ_MODEL_NAME set: dlq joins triggers + templates',
      )

      Deno.env.set('TRIGGERS_MODEL_NAME', 'false')
      assertEquals(
        getLocalAdminSubApps().map((app) => app.definition.name),
        [ADMIN_TEMPLATES_APPLICATION, ADMIN_DLQ_APPLICATION],
        'triggers explicitly disabled: only templates + dlq remain',
      )
    } finally {
      if (triggersEnv === undefined) Deno.env.delete('TRIGGERS_MODEL_NAME')
      else Deno.env.set('TRIGGERS_MODEL_NAME', triggersEnv)
      if (templatesBackendEnv === undefined) Deno.env.delete(TEMPLATES_BACKEND_ENV)
      else Deno.env.set(TEMPLATES_BACKEND_ENV, templatesBackendEnv)
      if (templatesModelEnv === undefined) Deno.env.delete(TEMPLATES_MODEL_ENV)
      else Deno.env.set(TEMPLATES_MODEL_ENV, templatesModelEnv)
      if (dlqModelEnv === undefined) Deno.env.delete(DLQ_MODEL_ENV)
      else Deno.env.set(DLQ_MODEL_ENV, dlqModelEnv)
    }
  },
)
