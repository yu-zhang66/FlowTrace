/**
 * Zod schema for the FlowTrace builtin DSL.
 *
 * Validates:
 *  - Process DSL (ProcessDslSchema)
 *  - System configuration under `systems:` (RuntimeSystemConfigSchema)
 *  - Top-level `runtime:` block (RuntimeConfigSchema)
 *  - Scenario review status (ScenarioReviewStatusSchema)
 *
 * The DSL is statically validated before execution. Unknown step types or
 * missing required fields MUST halt execution before the target system is
 * touched. Validation errors include the failing path (file/step/index).
 *
 * This module MUST NOT contain any business identifier.
 */

import { z } from 'zod';

export const RuntimeChannelSchema = z.enum(['http', 'browser']);
export type RuntimeChannelZ = z.infer<typeof RuntimeChannelSchema>;

export const RuntimeAdapterKindSchema = z.enum(['builtin', 'external', 'legacy']);
export type RuntimeAdapterKindZ = z.infer<typeof RuntimeAdapterKindSchema>;

export const RuntimePluginKindSchema = z.enum(['flow', 'data', 'observation']);
export type RuntimePluginKindZ = z.infer<typeof RuntimePluginKindSchema>;

export const ScenarioReviewStatusSchema = z.enum([
  'AUTO_EXTRACTED',
  'REVIEW_REQUIRED',
  'CONFIRMED',
]);
export type ScenarioReviewStatusZ = z.infer<typeof ScenarioReviewStatusSchema>;

const SelectorSchema = z.string().min(1);

const WaitForSchema = z.union([
  z.enum(['network-idle', 'domcontentloaded', 'load']),
  z.object({ selector: SelectorSchema, state: z.enum(['visible', 'hidden', 'attached', 'detached']).optional() }),
  z.object({ urlMatches: z.string().min(1) }),
  z.object({ ms: z.number().int().nonnegative() }),
]);

const AssertionSchema = z.union([
  z.object({ equals: z.object({ slot: z.string().optional(), value: z.unknown().optional() }) }),
  z.object({ notEquals: z.object({ slot: z.string().optional(), value: z.unknown().optional() }) }),
  z.object({ matches: z.object({ slot: z.string().optional(), pattern: z.string().min(1) }) }),
  z.object({ exists: z.string().min(1) }),
  z.object({ notExists: z.string().min(1) }),
]);

const StepBase = z.object({ label: z.string().optional() }).strict();

export const DslGotoStepSchema = StepBase.extend({
  type: z.literal('goto'),
  page: z.string().optional(),
  url: z.string().optional(),
  system: z.string().optional(),
}).refine((v) => Boolean(v.page) !== Boolean(v.url), {
  message: 'goto step requires exactly one of `page` or `url`',
});

export const DslFillStepSchema = StepBase.extend({
  type: z.literal('fill'),
  selector: SelectorSchema,
  value: z.string(),
  valueRef: z.string().optional(),
  system: z.string().optional(),
});

export const DslClickStepSchema = StepBase.extend({
  type: z.literal('click'),
  selector: SelectorSchema,
  system: z.string().optional(),
});

export const DslSelectStepSchema = StepBase.extend({
  type: z.literal('select'),
  selector: SelectorSchema,
  value: z.string(),
  valueRef: z.string().optional(),
  system: z.string().optional(),
});

export const DslUploadStepSchema = StepBase.extend({
  type: z.literal('upload'),
  selector: SelectorSchema,
  file: z.string().min(1),
  system: z.string().optional(),
});

export const DslWaitStepSchema = StepBase.extend({
  type: z.literal('wait'),
  for: WaitForSchema,
  timeoutMs: z.number().int().nonnegative().optional(),
  system: z.string().optional(),
});

export const DslRequestStepSchema = StepBase.extend({
  type: z.literal('request'),
  endpoint: z.string().optional(),
  method: z.enum(['GET', 'POST', 'PUT', 'DELETE', 'PATCH']).optional(),
  path: z.string().optional(),
  url: z.string().optional(),
  body: z.unknown().optional(),
  query: z.record(z.string()).optional(),
  captureAs: z.string().optional(),
  system: z.string().optional(),
}).refine(
  (v) => Boolean(v.endpoint) || Boolean(v.path) || Boolean(v.url),
  { message: 'request step requires `endpoint`, `path`, or `url`' },
);

export const DslObserveStepSchema = StepBase.extend({
  type: z.literal('observe'),
  selector: SelectorSchema,
  field: z.union([z.literal('text'), z.object({ attribute: z.string().min(1) })]),
  captureAs: z.string().optional(),
  system: z.string().optional(),
});

export const DslExtractStepSchema = StepBase.extend({
  type: z.literal('extract'),
  // For http channel the selector is optional (state is derived from the
  // latest slot's `currentState` field).
  selector: SelectorSchema.optional(),
  attribute: z.string().optional(),
  captureAs: z.string().min(1),
  system: z.string().optional(),
});

export const DslAssertStepSchema = StepBase.extend({
  type: z.literal('assert'),
  assert: AssertionSchema,
  severity: z.enum(['P0', 'P1', 'P2', 'P3']).optional(),
  system: z.string().optional(),
});

export const DslScreenshotStepSchema = StepBase.extend({
  type: z.literal('screenshot'),
  name: z.string().min(1),
  system: z.string().optional(),
});

export const DslConditionalStepSchema = StepBase.extend({
  type: z.literal('conditional'),
  when: AssertionSchema,
  then: z.array(z.lazy(() => DslStepSchema)).min(1),
  else: z.array(z.lazy(() => DslStepSchema)).optional(),
});

export const DslRepeatStepSchema = StepBase.extend({
  type: z.literal('repeat'),
  times: z.number().int().positive(),
  steps: z.array(z.lazy(() => DslStepSchema)).min(1),
});

export const DslStepSchema: z.ZodType<unknown> = z.union([
  DslGotoStepSchema,
  DslFillStepSchema,
  DslClickStepSchema,
  DslSelectStepSchema,
  DslUploadStepSchema,
  DslWaitStepSchema,
  DslRequestStepSchema,
  DslObserveStepSchema,
  DslExtractStepSchema,
  DslAssertStepSchema,
  DslScreenshotStepSchema,
  DslConditionalStepSchema,
  DslRepeatStepSchema,
]);

export const DslActionSchema = z.object({
  id: z.string().min(1),
  label: z.string().optional(),
  actor: z.string().optional(),
  steps: z.array(DslStepSchema).min(1),
  illegal: z
    .object({
      expectedErrorCode: z.string().min(1),
      message: z.string().optional(),
    })
    .optional(),
});

export const ProcessFsmSchema = z.object({
  states: z.array(z.object({ id: z.string().min(1), terminal: z.boolean().optional() })).min(1),
  transitions: z
    .array(
      z.object({
        from: z.string().min(1),
        action: z.string().min(1),
        to: z.string().min(1),
        roles: z.array(z.string()).optional(),
      }),
    )
    .min(1),
  roles: z.array(z.object({ id: z.string().min(1), description: z.string().optional() })).optional(),
});

export const ProcessDslSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  channel: RuntimeChannelSchema,
  fsm: ProcessFsmSchema.optional(),
  actions: z.array(DslActionSchema).min(1),
  terminalStates: z.array(z.string()).optional(),
  status: ScenarioReviewStatusSchema.optional(),
});

// Runtime system / external configs

export const RuntimeLoginConfigSchema = z.object({
  path: z.string().min(1),
  fields: z.record(z.string()),
  submit: z.string().optional(),
  successUrlPattern: z.string().optional(),
  actorMap: z.record(z.object({
    username: z.string(),
    password: z.string(),
  })).optional(),
});

export const RuntimeEndpointConfigSchema = z.object({
  method: z.enum(['GET', 'POST', 'PUT', 'DELETE', 'PATCH']),
  path: z.string().optional(),
  url: z.string().optional(),
  contentType: z.string().optional(),
  json: z.boolean().optional(),
}).refine((v) => Boolean(v.path) || Boolean(v.url), {
  message: 'endpoint requires `path` or `url`',
});

export const RuntimePageConfigSchema = z.object({
  path: z.string().min(1),
});

export const RuntimeRedactConfigSchema = z.object({
  fields: z.array(z.string()).optional(),
  headers: z.array(z.string()).optional(),
});

export const RuntimeBrowserOptionsSchema = z.object({
  headless: z.boolean().optional(),
  executablePath: z.string().optional(),
  args: z.array(z.string()).optional(),
  timeoutMs: z.number().int().nonnegative().optional(),
  captureScreenshots: z.boolean().optional(),
});

export const RuntimeSystemConfigSchema = z.object({
  id: z.string().min(1),
  label: z.string().optional(),
  baseUrl: z.string().min(1),
  channel: RuntimeChannelSchema,
  login: RuntimeLoginConfigSchema.optional(),
  endpoints: z.record(RuntimeEndpointConfigSchema).optional(),
  pages: z.record(RuntimePageConfigSchema).optional(),
  selectors: z.record(z.string()).optional(),
  redact: RuntimeRedactConfigSchema.optional(),
  browser: RuntimeBrowserOptionsSchema.optional(),
});

export const RuntimeExternalConfigSchema = z.object({
  module: z.string().min(1),
  name: z.string().min(1),
  version: z.string().min(1),
  kind: RuntimePluginKindSchema,
});

export const RuntimeConfigSchema = z
  .object({
    version: z.literal('1').default('1'),
    adapter: RuntimeAdapterKindSchema,
    external: RuntimeExternalConfigSchema.optional(),
    systems: z.record(RuntimeSystemConfigSchema).refine(
      (m) => Object.keys(m).length > 0,
      { message: 'runtime.systems must contain at least one system entry' },
    ),
  })
  .refine(
    (v) => v.adapter !== 'external' || Boolean(v.external),
    { message: 'runtime.external is required when runtime.adapter is `external`' },
  );

/** Combined top-level validator: validates a flowtrace.yaml `runtime:` block. */
export function validateRuntimeConfig(input: unknown) {
  return RuntimeConfigSchema.safeParse(input);
}

/** Validates a process DSL file. Returns a typed value or a structured error. */
export function validateProcessDsl(input: unknown) {
  return ProcessDslSchema.safeParse(input);
}

export interface DslValidationIssue {
  path: string;
  message: string;
}

/**
 * Convert a Zod failure into the canonical `DslValidationIssue[]` shape used by
 * the loader / CLI to surface actionable errors to users.
 */
export function issuesFromZodError(err: z.ZodError): DslValidationIssue[] {
  return err.issues.map((i) => ({
    path: i.path.length === 0 ? '<root>' : i.path.join('.'),
    message: i.message,
  }));
}
