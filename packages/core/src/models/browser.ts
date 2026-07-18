/**
 * Browser Action Model
 * 
 * Defines browser automation actions for executing test steps.
 * Each step can have different locators for legacy and current systems,
 * but must share the same business action semantic.
 */

import { z } from 'zod';
import { BusinessActionType } from './scenario.js';

// ============================================================
// Browser Action Types
// ============================================================

export const BrowserActionType = z.enum([
  'goto',
  'login',
  'fill',
  'select',
  'checkbox',
  'radio',
  'click',
  'upload',
  'wait',
  'hover',
  'approve',
  'reject',
  'return',
  'withdraw',
  'transfer',
  'countersign',
  'screenshot',
  'extract',
  'logout',
  'assert'
]);
export type BrowserActionType = z.infer<typeof BrowserActionType>;

// ============================================================
// Locator Definition
// ============================================================

export const SemanticLocatorSchema = z.object({
  label: z.string().optional(),
  role: z.string().optional(),
  name: z.string().optional(),
  testId: z.string().optional(),
  placeholder: z.string().optional(),
  text: z.string().optional(),
  title: z.string().optional(),
  altText: z.string().optional()
});
export type SemanticLocator = z.infer<typeof SemanticLocatorSchema>;

export const CssLocatorSchema = z.object({
  css: z.string().optional(),
  xpath: z.string().optional(),
  id: z.string().optional()
});
export type CssLocator = z.infer<typeof CssLocatorSchema>;

export const LocatorSchema = z.object({
  semantic: SemanticLocatorSchema.optional(),
  css: CssLocatorSchema.optional(),
  waitFor: z.string().optional(),
  timeout: z.number().optional()
});
export type Locator = z.infer<typeof LocatorSchema>;

export const TargetSchema = z.object({
  semantic: z.string().describe('Human-readable semantic label for the target element'),
  locator: z.array(LocatorSchema).min(1).describe('Locator options, tried in order until one matches'),
  description: z.string().optional()
});
export type Target = z.infer<typeof TargetSchema>;

// ============================================================
// Browser Action Value
// ============================================================

export const BrowserActionValueSchema = z.union([
  z.string().describe('Plain text value'),
  z.record(z.string()).describe('Key-value pairs for fill operations'),
  z.boolean().describe('Boolean for checkbox/radio'),
  z.number().describe('Number value'),
  z.array(z.string()).describe('Options for select')
]);
export type BrowserActionValue = z.infer<typeof BrowserActionValueSchema>;

// ============================================================
// Single Browser Action
// ============================================================

export const BrowserActionSchema = z.object({
  type: BrowserActionType,
  target: TargetSchema.optional(),
  value: BrowserActionValueSchema.optional(),
  description: z.string().optional(),
  optional: z.boolean().default(false),
  timeout: z.number().default(30000),
  retry: z.object({
    maxAttempts: z.number().default(3),
    delay: z.number().default(1000)
  }).optional(),
  assertions: z.array(z.object({
    type: z.enum(['visible', 'hidden', 'enabled', 'disabled', 'text', 'value', 'url', 'count']),
    expected: z.unknown(),
    message: z.string().optional()
  })).optional()
});
export type BrowserAction = z.infer<typeof BrowserActionSchema>;

// ============================================================
// Page Step Definition
// ============================================================

export const PageNavigationSchema = z.object({
  url: z.string(),
  waitFor: z.enum(['networkidle', 'domcontentloaded', 'load']).default('networkidle'),
  timeout: z.number().default(60000)
});
export type PageNavigation = z.infer<typeof PageNavigationSchema>;

// ============================================================
// Evidence Collection
// ============================================================

export const EvidenceCollectionSchema = z.object({
  screenshot: z.enum(['none', 'on-action', 'on-failure', 'always']).default('on-failure'),
  network: z.boolean().default(false),
  console: z.boolean().default(false),
  pageState: z.boolean().default(true),
  extractData: z.array(z.string()).optional()
});
export type EvidenceCollection = z.infer<typeof EvidenceCollectionSchema>;

// ============================================================
// Browser Step (for one side: legacy or current)
// ============================================================

export const BrowserStepSideSchema = z.object({
  navigation: PageNavigationSchema.optional(),
  actions: z.array(BrowserActionSchema),
  evidence: EvidenceCollectionSchema.optional(),
  expected: z.object({
    url: z.string().optional(),
    pageTitle: z.string().optional(),
    visible: z.array(z.string()).optional(),
    hidden: z.array(z.string()).optional(),
    extraction: z.record(z.string()).optional()
  }).optional()
});
export type BrowserStepSide = z.infer<typeof BrowserStepSideSchema>;

// ============================================================
// Browser Step (combined for dual-run)
// ============================================================

export const BrowserStepSchema = z.object({
  id: z.string(),
  intent: z.string().describe('Business intent of this step'),
  businessAction: BusinessActionType,
  actor: z.string(),
  legacy: BrowserStepSideSchema.optional(),
  current: BrowserStepSideSchema.optional(),
  expected: z.object({
    semanticEvent: z.string().optional(),
    businessState: z.string().optional(),
    businessData: z.record(z.unknown()).optional()
  }).optional(),
  onFailure: z.enum(['continue', 'stop', 'mark-skipped']).default('stop')
});
export type BrowserStep = z.infer<typeof BrowserStepSchema>;

// ============================================================
// Browser Execution Result
// ============================================================

export const BrowserStepResultSchema = z.object({
  stepId: z.string(),
  success: z.boolean(),
  url: z.string(),
  pageTitle: z.string().optional(),
  usedLocator: LocatorSchema.optional().describe('Which locator was successfully used'),
  visibleTexts: z.array(z.string()).optional(),
  extractedData: z.record(z.unknown()).optional(),
  screenshotPath: z.string().optional(),
  networkEvidence: z.array(z.object({
    url: z.string(),
    method: z.string(),
    requestHeaders: z.record(z.string()).optional(),
    requestBody: z.unknown(),
    responseStatus: z.number(),
    responseBody: z.unknown(),
    timing: z.number()
  })).optional(),
  error: z.string().optional(),
  errorLocator: z.string().optional().describe('Which locator failed'),
  timestamp: z.string().datetime()
});
export type BrowserStepResult = z.infer<typeof BrowserStepResultSchema>;

// ============================================================
// Browser Evidence
// ============================================================

export const BrowserEvidenceSchema = z.object({
  screenshots: z.array(z.object({
    path: z.string(),
    stepId: z.string(),
    timestamp: z.string(),
    triggeredBy: z.enum(['action', 'failure', 'manual'])
  })),
  networkCalls: z.array(z.object({
    url: z.string(),
    method: z.string(),
    request: z.record(z.unknown()),
    response: z.record(z.unknown()),
    timestamp: z.string()
  })),
  pageStates: z.array(z.object({
    stepId: z.string(),
    url: z.string(),
    title: z.string(),
    data: z.record(z.unknown())
  })),
  consoleLogs: z.array(z.object({
    level: z.enum(['log', 'warn', 'error']),
    message: z.string(),
    timestamp: z.string()
  })).optional()
});
export type BrowserEvidence = z.infer<typeof BrowserEvidenceSchema>;

// ============================================================
// Browser Execution Adapter Interface
// ============================================================

export interface BrowserExecutionAdapter {
  initialize(config: {
    headless?: boolean;
    baseUrl?: string;
    timeout?: number;
  }): Promise<void>;
  
  login(actor: {
    username: string;
    password: string;
    loginUrl?: string;
    usernameSelector?: string;
    passwordSelector?: string;
    submitSelector?: string;
  }): Promise<void>;
  
  executeStep(step: BrowserStep, side: 'legacy' | 'current'): Promise<BrowserStepResult>;
  
  captureEvidence(): Promise<BrowserEvidence>;
  
  logout(): Promise<void>;
  
  cleanup(): Promise<void>;
}

// ============================================================
// Dual Browser Execution Result
// ============================================================

export const DualBrowserStepResultSchema = z.object({
  stepId: z.string(),
  legacyResult: BrowserStepResultSchema.optional(),
  currentResult: BrowserStepResultSchema.optional(),
  comparison: z.object({
    successMatch: z.boolean(),
    urlMatch: z.boolean(),
    dataMatch: z.boolean(),
    businessStateMatch: z.boolean().optional()
  }),
  differences: z.array(z.object({
    category: z.string(),
    legacyValue: z.unknown(),
    currentValue: z.unknown(),
    severity: z.enum(['P0', 'P1', 'P2', 'P3'])
  }))
});
export type DualBrowserStepResult = z.infer<typeof DualBrowserStepResultSchema>;
