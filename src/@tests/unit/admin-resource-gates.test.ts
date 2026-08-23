import { assertEquals } from 'jsr:@std/assert@^1.0.15'
import { DLQ_MODEL_ENV } from '@zanix/database'
import { TEMPLATES_BACKEND_ENV } from '@zanix/notifications'
import {
  isDlqResourceEnabled,
  isTemplatesResourceEnabled,
  isTriggersResourceEnabled,
} from 'modules/admin-resource-gates.ts'

function withEnv(vars: Record<string, string | undefined>, fn: () => void) {
  const previous = new Map(Object.keys(vars).map((key) => [key, Deno.env.get(key)]))
  try {
    for (const [key, value] of Object.entries(vars)) {
      if (value === undefined) Deno.env.delete(key)
      else Deno.env.set(key, value)
    }
    fn()
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) Deno.env.delete(key)
      else Deno.env.set(key, value)
    }
  }
}

Deno.test('isTriggersResourceEnabled(): true by default (no TRIGGERS_MODEL_NAME set)', () => {
  withEnv({ TRIGGERS_MODEL_NAME: undefined }, () => {
    assertEquals(isTriggersResourceEnabled(), true)
  })
})

Deno.test('isTriggersResourceEnabled(): false once TRIGGERS_MODEL_NAME=false', () => {
  withEnv({ TRIGGERS_MODEL_NAME: 'false' }, () => {
    assertEquals(isTriggersResourceEnabled(), false)
  })
})

Deno.test('isTemplatesResourceEnabled(): false by default (no TEMPLATES_BACKEND set)', () => {
  withEnv({ [TEMPLATES_BACKEND_ENV]: undefined }, () => {
    assertEquals(isTemplatesResourceEnabled(), false)
  })
})

Deno.test('isTemplatesResourceEnabled(): true once TEMPLATES_BACKEND=local', () => {
  withEnv({ [TEMPLATES_BACKEND_ENV]: 'local' }, () => {
    assertEquals(isTemplatesResourceEnabled(), true)
  })
})

Deno.test('isTemplatesResourceEnabled(): false when TEMPLATES_BACKEND=remote', () => {
  withEnv({ [TEMPLATES_BACKEND_ENV]: 'remote' }, () => {
    assertEquals(isTemplatesResourceEnabled(), false)
  })
})

Deno.test('isDlqResourceEnabled(): false by default (no DLQ_MODEL_NAME set)', () => {
  withEnv({ [DLQ_MODEL_ENV]: undefined }, () => {
    assertEquals(isDlqResourceEnabled(), false)
  })
})

Deno.test('isDlqResourceEnabled(): true once DLQ_MODEL_NAME is set', () => {
  withEnv({ [DLQ_MODEL_ENV]: 'zanix-dlq-gates-unit-test' }, () => {
    assertEquals(isDlqResourceEnabled(), true)
  })
})
