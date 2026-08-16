/**
 * Central environment-variable registry (Task #1053).
 *
 * Every environment variable the application reads MUST be declared here (or
 * registered by the owning module at load time) with a description, a secret
 * flag, and a category. All reads go through {@link getEnvironmentVariable},
 * which fails loudly on unregistered names. This makes the environment
 * contract explicit, provides the data source for the future system-status
 * plugin, and supports on-the-fly value filtering via per-variable transform
 * hooks and overrides.
 *
 * Design constraints:
 *  - PURE LEAF MODULE: no imports (not even the logger). It must be usable by
 *    the earliest boot code — DATABASE_URL assembly and the production entry
 *    point — before any app initialization.
 *  - Direct `process.env` access is allowed ONLY inside this module. The
 *    author-time check `scripts/dev/check-env-registry.ts` enforces this
 *    across server/, shared/, and scripts/.
 *
 * Categories:
 *  - "core":     application-level configuration (DATABASE_URL, AUTH_*, ...)
 *  - "platform": injected by the hosting platform (REPLIT_*, REPL_*, ...)
 *  - any component id (e.g. "sitespecific.t631.client"): variables owned by a
 *    component, registered by that component's module at load time.
 */

export type EnvironmentVariableCategory = "core" | "platform" | (string & {});

export interface EnvironmentVariableDeclaration {
  /** Exact environment variable name, e.g. "DATABASE_URL". */
  name: string;
  /** Human-readable purpose, shown by future status/registry consumers. */
  description: string;
  /** True when the VALUE must never be displayed (keys, tokens, passwords). */
  secret: boolean;
  /** "core", "platform", or the owning component id. */
  category: EnvironmentVariableCategory;
  /** Optional: throw from the getter when the value is unset/empty. */
  required?: boolean;
  /**
   * Optional per-variable transform hook applied to the raw value on every
   * read (in-application filtering, normalization, defaulting).
   */
  transform?: (value: string | undefined) => string | undefined;
}

const registry = new Map<string, EnvironmentVariableDeclaration>();
const overrides = new Map<string, (value: string | undefined) => string | undefined>();

/**
 * DB-backed override source (Task #1080). Installed at boot (after the
 * database is up) by `server/services/env-overrides.ts`; consulted ONLY when
 * the variable is absent from the real process environment, so a value set
 * in the deployment pipeline always "locks" the variable. Must be a
 * synchronous lookup (in-memory cache) — this module stays a pure leaf.
 */
let dbOverrideSource: ((name: string) => string | undefined) | null = null;

export function setEnvironmentVariableOverrideSource(
  fn: ((name: string) => string | undefined) | null,
): void {
  dbOverrideSource = fn;
}

/**
 * Variables that can never be usefully or safely overridden from the
 * database: anything needed to REACH the database, plus security-critical
 * boot configuration. Platform-injected variables are excluded by category.
 */
const ENV_OVERRIDE_DENYLIST = new Set<string>([
  "NODE_ENV",
  "PORT",
  "DATABASE_URL",
  "DATABASE_DRIVER",
  "DB_HOST",
  "DB_PORT",
  "DB_NAME",
  "DB_USER",
  "DB_USERNAME",
  "DB_PASSWORD",
  "DB_SECRET",
  "DB_SSLMODE",
  "SESSION_SECRET",
  "SESSION_TTL",
  "ALLOW_INSECURE_SESSION_SECRET",
  // Boot/debug escape hatches: deployment-pipeline decisions only.
  "ALLOW_EMPTY_DB_BOOTSTRAP",
  "ALLOW_DB_PUSH",
  "SKIP_SCHEMA_DRIFT_CHECK",
  "SKIP_DIST_FRESHNESS_CHECK",
  "EXPOSE_BOOT_ERRORS",
]);

/**
 * Authentication bootstrap configuration is never overridable: a DB write
 * could silently redirect sign-in/token traffic or swap provider trust
 * credentials (and persists across restarts). These settings must come from
 * the deployment pipeline only.
 */
const ENV_OVERRIDE_DENY_PREFIXES = [
  "AUTH_",
  "LOCAL_AUTH_",
  "OKTA_",
  "SAML_",
  "OAUTH_",
  "CLERK_",
  "VITE_CLERK_",
  "SESSION_",
  "DB_",
];

/** Whether a registered variable may be overridden from the database. */
export function isEnvironmentVariableOverridable(name: string): boolean {
  const decl = registry.get(name);
  if (!decl) return false;
  if (decl.category === "platform") return false;
  if (ENV_OVERRIDE_DENYLIST.has(name)) return false;
  return !ENV_OVERRIDE_DENY_PREFIXES.some((p) => name.startsWith(p));
}

/**
 * Release sentinel (Task #1085). Deployed containers can carry stale env
 * vars forever (ECS bakes env into the task definition revision), and some
 * pipelines (GitHub) refuse empty-string variables. Setting a variable to
 * this exact value — or to the empty string, where the pipeline allows it —
 * declares "this variable is no longer set": the app treats it as absent
 * everywhere (reads as unset; DB override applies where the rules allow).
 * The consent to release travels through the deploy pipeline itself.
 */
export const ENV_RELEASE_SENTINEL = "__UNSET__";

function isReleasedValue(value: string | undefined): boolean {
  return value === "" || value === ENV_RELEASE_SENTINEL;
}

/**
 * The process-env value with release semantics applied: a released value
 * (empty string or the sentinel) reads as undefined. THE single presence
 * rule — the getter, the lock check, and the listing all use it.
 */
function readProcessEnv(name: string): string | undefined {
  const value = process.env[name];
  return value === undefined || isReleasedValue(value) ? undefined : value;
}

/**
 * True when the variable is effectively set in the real process env (a
 * released value — empty or the sentinel — counts as NOT set).
 */
export function isEnvironmentVariableSetInProcess(name: string): boolean {
  return readProcessEnv(name) !== undefined;
}

/**
 * True when the variable is present in the process env but carries a
 * released value (deliberately neutralized in the deployment settings).
 */
export function isEnvironmentVariableReleased(name: string): boolean {
  const value = process.env[name];
  return value !== undefined && isReleasedValue(value);
}

/**
 * Declare an environment variable. Idempotent: re-registering the same name
 * replaces the declaration (last one wins), so modules that share a variable
 * can each register it at load time without ordering hazards.
 */
export function registerEnvironmentVariable(decl: EnvironmentVariableDeclaration): void {
  if (!decl.name || typeof decl.name !== "string") {
    throw new Error("registerEnvironmentVariable: declaration requires a non-empty name");
  }
  registry.set(decl.name, { ...decl });
}

/** Bulk form of {@link registerEnvironmentVariable}. */
export function registerEnvironmentVariables(
  decls: readonly EnvironmentVariableDeclaration[],
): void {
  for (const decl of decls) registerEnvironmentVariable(decl);
}

export function isEnvironmentVariableRegistered(name: string): boolean {
  return registry.has(name);
}

/**
 * Read an environment variable's value. THE single sanctioned read path.
 *
 * Throws when the variable was never registered — using an undeclared
 * variable is a programming error and must fail loudly, not silently return
 * undefined. Applies the declaration's transform hook and any runtime
 * override, then enforces `required`.
 */
export function getEnvironmentVariable(name: string): string | undefined {
  const decl = registry.get(name);
  if (!decl) {
    throw new Error(
      `Environment variable "${name}" is not registered. Declare it with ` +
        `registerEnvironmentVariable() (see server/config/env-registry.ts) before reading it.`,
    );
  }
  let value: string | undefined = readProcessEnv(name);
  if (value === undefined && dbOverrideSource && isEnvironmentVariableOverridable(name)) {
    value = dbOverrideSource(name);
  }
  if (decl.transform) value = decl.transform(value);
  const override = overrides.get(name);
  if (override) value = override(value);
  if (decl.required && (value === undefined || value === "")) {
    throw new Error(
      `Environment variable "${name}" is required but not set (${decl.description}).`,
    );
  }
  return value;
}

/**
 * Install (fn) or remove (null) a runtime override applied after the
 * declaration transform on every read of `name`. For in-application
 * filtering/overriding without touching the process environment.
 */
export function setEnvironmentVariableOverride(
  name: string,
  fn: ((value: string | undefined) => string | undefined) | null,
): void {
  if (!registry.has(name)) {
    throw new Error(
      `Cannot set override for unregistered environment variable "${name}".`,
    );
  }
  if (fn === null) overrides.delete(name);
  else overrides.set(name, fn);
}

/**
 * Write an environment variable value into the process environment. Only for
 * registry-sanctioned boot-time writes (e.g. DATABASE_URL assembly from
 * DB_* parts). The name must be registered.
 */
export function setEnvironmentVariable(name: string, value: string): void {
  if (!registry.has(name)) {
    throw new Error(
      `Cannot set unregistered environment variable "${name}". Register it first.`,
    );
  }
  process.env[name] = value;
}

export interface EnvironmentVariableInfo {
  name: string;
  description: string;
  secret: boolean;
  category: EnvironmentVariableCategory;
  required: boolean;
  /** Whether the variable currently has a non-empty value. Never the value. */
  isSet: boolean;
  /** Where the current value comes from (null when unset). */
  source: "environment" | "override" | null;
  /** Whether a DB override is allowed for this variable. */
  overridable: boolean;
  /** Present in the process env but deliberately released (empty/sentinel). */
  released: boolean;
}

/**
 * Enumerate all registered variables with metadata and presence (never
 * values). Data source for the future system-status plugin.
 */
export function listEnvironmentVariables(): EnvironmentVariableInfo[] {
  return Array.from(registry.values())
    .map((d) => {
      // Presence must match the getter's fallback rule exactly: released
      // values (empty/sentinel) read as absent everywhere.
      const envSet = readProcessEnv(d.name) !== undefined;
      const overridable = isEnvironmentVariableOverridable(d.name);
      const overrideValue =
        !envSet && overridable && dbOverrideSource ? dbOverrideSource(d.name) : undefined;
      const source: EnvironmentVariableInfo["source"] = envSet
        ? "environment"
        : overrideValue !== undefined
          ? "override"
          : null;
      return {
        name: d.name,
        description: d.description,
        secret: d.secret,
        category: d.category,
        required: d.required === true,
        isSet: source !== null,
        source,
        overridable,
        released: isEnvironmentVariableReleased(d.name),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Names of environment variables currently PRESENT in the process
 * environment that match `predicate` (registered or not). For diagnostics
 * that report which vars exist without exposing values (e.g. DATABASE_URL
 * assembly failure messages).
 */
export function listPresentEnvironmentVariableNames(
  predicate: (name: string) => boolean,
): string[] {
  return Object.keys(process.env).filter(predicate).sort();
}

/**
 * The raw process environment object. SANCTIONED USES ONLY: passing an
 * environment to a spawned child process, or handing the environment to an
 * injection surface that filters it itself. NEVER for reading individual
 * variables — use {@link getEnvironmentVariable}.
 */
export function getRawProcessEnv(): NodeJS.ProcessEnv {
  return process.env;
}

// ---------------------------------------------------------------------------
// Core variables — application-level configuration, registered at module load
// so they are available to the earliest boot code.
// ---------------------------------------------------------------------------
registerEnvironmentVariables([
  { name: "NODE_ENV", description: "Runtime mode: development | production.", secret: false, category: "core" },
  { name: "PORT", description: "HTTP port the server listens on (default 5000).", secret: false, category: "core" },
  { name: "DATABASE_URL", description: "PostgreSQL connection URL. Assembled from DB_* parts at boot when absent.", secret: true, category: "core" },
  { name: "DATABASE_DRIVER", description: "Force the DB driver: neon | pg (auto-detected from the URL otherwise).", secret: false, category: "core" },
  // DATABASE_URL assembly parts (ECS/Terraform task definition injects parts,
  // not a full URL — see server/config/assemble-database-url.ts).
  { name: "DB_HOST", description: "Database host (URL assembly part).", secret: false, category: "core" },
  { name: "DB_PORT", description: "Database port (URL assembly part).", secret: false, category: "core" },
  { name: "DB_NAME", description: "Database name (URL assembly part).", secret: false, category: "core" },
  { name: "DB_USER", description: "Database username (URL assembly part).", secret: false, category: "core" },
  { name: "DB_USERNAME", description: "Database username, alternate spelling (URL assembly part).", secret: false, category: "core" },
  { name: "DB_PASSWORD", description: "Database password (URL assembly part).", secret: true, category: "core" },
  { name: "DB_SECRET", description: "AWS Secrets Manager DB secret: JSON blob or raw password (URL assembly part).", secret: true, category: "core" },
  { name: "DB_SSLMODE", description: "sslmode for the assembled DATABASE_URL (default require).", secret: false, category: "core" },
  { name: "SESSION_SECRET", description: "Express session signing secret.", secret: true, category: "core" },
  { name: "SESSION_TTL", description: "Session time-to-live in milliseconds.", secret: false, category: "core" },
  { name: "ALLOW_INSECURE_SESSION_SECRET", description: "Set to 1 to permit the fixed insecure session-secret fallback in non-prod deploys.", secret: false, category: "core" },
  { name: "ALLOW_EMPTY_DB_BOOTSTRAP", description: "Set to 1 to let boot create the full schema on a completely empty database.", secret: false, category: "core" },
  { name: "ALLOW_DB_PUSH", description: "Set to 1 to permit scripts/db-push.ts to run (guarded: push is hazardous).", secret: false, category: "core" },
  { name: "SKIP_SCHEMA_DRIFT_CHECK", description: "Set to 1 to skip the startup schema-drift boot gate (dev escape hatch).", secret: false, category: "core" },
  { name: "SKIP_DIST_FRESHNESS_CHECK", description: "Set to 1 to skip the stale-dist build freshness guard in production entry.", secret: false, category: "core" },
  { name: "EXPOSE_BOOT_ERRORS", description: "Set to 1 to render init-failure details (message + stack) on the boot failure page.", secret: false, category: "core" },
  { name: "FILESYSTEMS", description: "JSON map of filesystem configs (see server/services/files/config.ts). *_secret settings name further env vars.", secret: false, category: "core" },
  { name: "PUBLIC_URL", description: "Explicit public base URL for callback links when platform domains are absent.", secret: false, category: "core" },
  // Auth (multi-provider) configuration.
  { name: "AUTH_PROVIDER", description: "Comma-separated list of enabled auth providers (replit,okta,saml,oauth,local,clerk).", secret: false, category: "core" },
  { name: "AUTH_DEFAULT_PROVIDER", description: "Which configured auth provider is the default.", secret: false, category: "core" },
  { name: "AUTH_LOCAL_ENABLED", description: "Set to false to disable the local auth provider without editing AUTH_PROVIDER.", secret: false, category: "core" },
  { name: "AUTH_LOCAL_PEPPER", description: "Pepper concatenated to passwords before hashing for local auth.", secret: true, category: "core" },
  { name: "LOCAL_AUTH_EMAIL", description: "Email of the local-auth credential to seed at boot.", secret: false, category: "core" },
  { name: "LOCAL_AUTH_PASSWORD_HASH", description: "Password hash of the local-auth credential to seed at boot.", secret: true, category: "core" },
  { name: "ISSUER_URL", description: "OIDC issuer URL for the Replit auth provider (legacy name).", secret: false, category: "core" },
  { name: "REPLIT_ISSUER_URL", description: "OIDC issuer URL for the Replit auth provider.", secret: false, category: "core" },
  { name: "REPLIT_CLIENT_ID", description: "OIDC client id for the Replit auth provider.", secret: false, category: "core" },
  { name: "OKTA_ISSUER_URL", description: "Okta OIDC issuer URL.", secret: false, category: "core" },
  { name: "OKTA_CLIENT_ID", description: "Okta OIDC client id.", secret: false, category: "core" },
  { name: "OKTA_CLIENT_SECRET", description: "Okta OIDC client secret.", secret: true, category: "core" },
  { name: "OKTA_CALLBACK_PATH", description: "Override for the Okta OIDC callback path.", secret: false, category: "core" },
  { name: "SAML_ENTRY_POINT", description: "SAML IdP entry point URL.", secret: false, category: "core" },
  { name: "SAML_ISSUER", description: "SAML issuer (SP entity id).", secret: false, category: "core" },
  { name: "SAML_CERT", description: "SAML IdP signing certificate (PEM).", secret: true, category: "core" },
  { name: "SAML_CALLBACK_PATH", description: "Override for the SAML callback path.", secret: false, category: "core" },
  { name: "OAUTH_AUTHORIZATION_URL", description: "Generic OAuth2 authorization endpoint.", secret: false, category: "core" },
  { name: "OAUTH_TOKEN_URL", description: "Generic OAuth2 token endpoint.", secret: false, category: "core" },
  { name: "OAUTH_USERINFO_URL", description: "Generic OAuth2 userinfo endpoint.", secret: false, category: "core" },
  { name: "OAUTH_CLIENT_ID", description: "Generic OAuth2 client id.", secret: false, category: "core" },
  { name: "OAUTH_CLIENT_SECRET", description: "Generic OAuth2 client secret.", secret: true, category: "core" },
  { name: "OAUTH_SCOPE", description: "Generic OAuth2 scope string.", secret: false, category: "core" },
  { name: "OAUTH_CALLBACK_PATH", description: "Override for the generic OAuth2 callback path.", secret: false, category: "core" },
  { name: "CLERK_PUBLISHABLE_KEY", description: "Clerk publishable key (dev/default).", secret: false, category: "core" },
  { name: "CLERK_PUBLISHABLE_KEY_PROD", description: "Clerk publishable key used when NODE_ENV=production.", secret: false, category: "core" },
  { name: "CLERK_SECRET_KEY", description: "Clerk secret key (dev/default).", secret: true, category: "core" },
  { name: "CLERK_SECRET_KEY_PROD", description: "Clerk secret key used when NODE_ENV=production.", secret: true, category: "core" },
  { name: "VITE_CLERK_PUBLISHABLE_KEY", description: "Clerk publishable key as exposed to the Vite client bundle (server fallback read).", secret: false, category: "core" },
]);

// ---------------------------------------------------------------------------
// Platform variables — injected by the hosting environment (Replit / deploys).
// ---------------------------------------------------------------------------
registerEnvironmentVariables([
  { name: "REPL_ID", description: "Replit workspace id; doubles as the Replit OIDC client id.", secret: false, category: "platform" },
  { name: "REPL_SLUG", description: "Replit workspace slug (legacy repl.co host construction).", secret: false, category: "platform" },
  { name: "REPL_OWNER", description: "Replit workspace owner (legacy repl.co host construction).", secret: false, category: "platform" },
  { name: "REPL_IDENTITY", description: "Replit workspace identity token (connector auth).", secret: true, category: "platform" },
  { name: "WEB_REPL_RENEWAL", description: "Replit deployment identity token (connector auth).", secret: true, category: "platform" },
  { name: "REPLIT_CONNECTORS_HOSTNAME", description: "Hostname of the Replit connectors API.", secret: false, category: "platform" },
  { name: "REPLIT_DEV_DOMAIN", description: "Public development domain of this workspace.", secret: false, category: "platform" },
  { name: "REPLIT_DOMAINS", description: "Comma-separated public domains of this deployment.", secret: false, category: "platform" },
  { name: "REPLIT_DEPLOYMENT", description: "Set to 1 inside a Replit deployment container.", secret: false, category: "platform" },
  { name: "REPLIT_DEPLOYMENT_DOMAIN", description: "Public domain of the Replit deployment.", secret: false, category: "platform" },
  { name: "DEFAULT_OBJECT_STORAGE_BUCKET_ID", description: "Replit object storage default bucket id.", secret: false, category: "platform" },
  { name: "PUBLIC_OBJECT_SEARCH_PATHS", description: "Comma-separated public search paths in object storage.", secret: false, category: "platform" },
  { name: "PRIVATE_OBJECT_DIR", description: "Private directory prefix in object storage.", secret: false, category: "platform" },
]);
