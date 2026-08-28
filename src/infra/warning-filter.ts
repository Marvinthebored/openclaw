// Filters known noisy process warnings once per runtime.
import { resolveGlobalSingleton } from "../shared/global-singleton.js";

const warningFilterKey = Symbol.for("openclaw.warning-filter");
/**
 * Node's built-in `warning` printer, captured by identity at module load. This
 * module is imported during startup, before application code registers warning
 * listeners, and stock Node installs exactly one.
 */
const nodeDefaultWarningListeners = process.listeners("warning");

/** Normalized process warning fields used by the shared warning suppressor. */
export type ProcessWarning = {
  code?: string;
  name?: string;
  message?: string;
};

type ProcessWarningInstallState = {
  installed: boolean;
};

/** Returns whether a process warning matches a known noisy runtime/dependency warning. */
export function shouldIgnoreWarning(warning: ProcessWarning): boolean {
  if (warning.code === "DEP0040" && warning.message?.includes("punycode")) {
    return true;
  }
  if (warning.code === "DEP0060" && warning.message?.includes("util._extend")) {
    return true;
  }
  if (
    warning.name === "ExperimentalWarning" &&
    warning.message?.includes("SQLite is an experimental feature")
  ) {
    return true;
  }
  return false;
}

function normalizeWarningArgs(args: unknown[]): ProcessWarning {
  const warningArg = args[0];
  const secondArg = args[1];
  const thirdArg = args[2];
  let name: string | undefined;
  let code: string | undefined;
  let message: string | undefined;

  if (warningArg instanceof Error) {
    name = warningArg.name;
    message = warningArg.message;
    code = (warningArg as Error & { code?: string }).code;
  } else if (typeof warningArg === "string") {
    message = warningArg;
  }

  if (secondArg && typeof secondArg === "object" && !Array.isArray(secondArg)) {
    const options = secondArg as { type?: unknown; code?: unknown };
    if (typeof options.type === "string") {
      name = options.type;
    }
    if (typeof options.code === "string") {
      code = options.code;
    }
  } else {
    if (typeof secondArg === "string") {
      name = secondArg;
    }
    if (typeof thirdArg === "string") {
      code = thirdArg;
    }
  }

  return { name, code, message };
}

/** Installs the global process warning filter once for the current JS realm. */
export function installProcessWarningFilter(): void {
  const state = resolveGlobalSingleton<ProcessWarningInstallState>(warningFilterKey, () => ({
    installed: false,
  }));
  if (state.installed) {
    return;
  }

  const originalEmitWarning = process.emitWarning.bind(process);
  const wrappedEmitWarning: typeof process.emitWarning = ((...args: unknown[]) => {
    if (shouldIgnoreWarning(normalizeWarningArgs(args))) {
      return;
    }
    // Node does not emit Error + options warnings through the same path after wrapping; preserve
    // visibility by re-emitting a normalized warning object for unsuppressed cases.
    if (
      args[0] instanceof Error &&
      args[1] &&
      typeof args[1] === "object" &&
      !Array.isArray(args[1])
    ) {
      const warning = args[0];
      const emitted = Object.assign(new Error(warning.message), {
        name: warning.name,
        code: (warning as Error & { code?: string }).code,
      });
      process.emit("warning", emitted);
      return;
    }
    Reflect.apply(originalEmitWarning, process, args);
  }) as typeof process.emitWarning;

  process.emitWarning = wrappedEmitWarning;

  // Node's printer writes through console.error, and the console capture maps
  // console.error to ERROR, so every process warning was recorded as a failure.
  // Rather than reimplement the printer, keep calling Node's own and redirect
  // only where its output lands. Node therefore keeps ownership of formatting,
  // `--disable-warning` filtering, `--trace-warnings` and `--trace-deprecation`
  // stacks, the remediation hint, and file routing under `--redirect-warnings`,
  // `NODE_REDIRECT_WARNINGS`, and `--diagnostic-dir` — routed warnings never
  // reach console.error, so the redirect below simply never fires for them.
  //
  // Replace only the stock single listener Node installs, matched by identity:
  // under `--no-warnings` there is none, and a host that registered its own
  // warning handling is left alone.
  const [nodeWarningPrinter] = nodeDefaultWarningListeners;
  if (nodeDefaultWarningListeners.length === 1 && nodeWarningPrinter) {
    const currentListeners = new Set(process.listeners("warning"));
    if (currentListeners.has(nodeWarningPrinter)) {
      process.off("warning", nodeWarningPrinter);
      // A logger that warns while reporting a warning would recurse back in.
      let reporting = false;
      process.on("warning", (warning: Error) => {
        if (reporting) {
          return;
        }
        reporting = true;
        const consoleError = console.error;
        const forwardToWarn = (...args: unknown[]) => {
          console.warn(...args);
        };
        // SAFETY: forwards the printer's own arguments to console.warn unchanged.
        console.error = forwardToWarn as typeof console.error;
        try {
          nodeWarningPrinter.call(process, warning);
        } finally {
          console.error = consoleError;
          reporting = false;
        }
      });
    }
  }

  state.installed = true;
}
