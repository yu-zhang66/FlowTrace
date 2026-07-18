/**
 * Builtin runtime facade for FlowTrace.
 *
 * Selects the per-system channel (`http` or `browser`) from the project's
 * `systems:` mapping and exposes a unified `BuiltinRuntime` interface that
 * the DSL interpreter uses. External plugins and legacy adapters are wired
 * in by the loader (`runtime-loader`) — this module is only the builtin path.
 */

import { BuiltinHttpRuntime } from './builtin-http-runtime.js';
import { BuiltinBrowserRuntime } from './builtin-browser-runtime.js';
import type { RuntimeSystemConfig } from './types.js';

export interface BuiltinRuntimeOptions {
  system: RuntimeSystemConfig;
  side: string;
  evidenceRoot: string | null;
}

export type BuiltinRuntime = BuiltinHttpRuntime | BuiltinBrowserRuntime;

export function createBuiltinRuntime(options: BuiltinRuntimeOptions): BuiltinRuntime {
  switch (options.system.channel) {
    case 'http':
      return new BuiltinHttpRuntime(options);
    case 'browser':
      return new BuiltinBrowserRuntime(options);
    default: {
      const exhaustive: never = options.system.channel;
      throw new Error(`Unsupported builtin runtime channel: ${String(exhaustive)}`);
    }
  }
}