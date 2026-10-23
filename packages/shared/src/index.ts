// Contracts shared by the API (validation) and the web client (types). No runtime logic beyond schemas.
import { z } from 'zod';

export const FAMILIES = ['chrome', 'firefox', 'edge', 'safari'] as const;
export type Family = (typeof FAMILIES)[number];

export const AVAILABILITY = ['ready', 'not-provisioned', 'unsupported-architecture', 'offline', 'busy', 'verification-failed'] as const;
export type Availability = (typeof AVAILABILITY)[number];

export const OUTCOMES = ['not-run', 'passed', 'failed', 'blocked', 'skipped'] as const;
export type Outcome = (typeof OUTCOMES)[number];

export const ACTIVE_STATES = ['requested', 'validating', 'queued', 'provisioning', 'starting', 'verifying', 'running', 'closing'] as const;
export const FINAL_STATES = ['completed', 'failed-to-start', 'expired', 'interrupted', 'closed-with-error'] as const;
export type SessionState = (typeof ACTIVE_STATES)[number] | (typeof FINAL_STATES)[number];

export const ERROR_CODES = [
  'INVALID_URL', 'INVALID_REQUEST', 'NOT_FOUND', 'UNSUPPORTED_ARCH', 'BROWSER_NOT_PROVISIONED', 'BROWSER_VERSION_MISMATCH',
  'WORKER_OFFLINE', 'NO_SESSION_CAPACITY', 'SESSION_START_TIMEOUT', 'VIEWER_UNAVAILABLE', 'SESSION_EXPIRED',
  'SESSION_NOT_RUNNING', 'SESSION_INTERRUPTED', 'NAVIGATION_FAILED', 'EVIDENCE_CAPTURE_FAILED', 'GRID_UNAVAILABLE', 'TRANSFER_UNSUPPORTED', 'TRANSFER_TOO_LARGE',
  'FORBIDDEN_ORIGIN', 'CONFLICT', 'INTERNAL',
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];
export interface ApiError { error: { code: ErrorCode; message: string; details?: unknown } }

/** One browser build BrowserLab may launch. Lives in browser-images/catalog.json. */
export const CatalogEntrySchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9.-]{2,80}$/),
  family: z.enum(FAMILIES),
  brand: z.string().min(1),
  channel: z.enum(['stable', 'esr', 'beta']),
  engine: z.enum(['blink', 'gecko', 'webkit']),
  requestedVersion: z.string().min(1),
  /** Regex the actual full browser version must match. */
  versionMatch: z.string().min(1),
  /** Expected product name on the browser's own version page (chrome://version etc.). */
  executableProduct: z.string().optional(),
  /** Firefox: expected update channel reported by about:support. */
  updateChannel: z.string().optional(),
  platformName: z.enum(['linux', 'mac']),
  /** CPU architectures this image runs on natively (multi-arch images list both). */
  architectures: z.array(z.enum(['amd64', 'arm64'])).min(1),
  provider: z.enum(['selenium-docker', 'safari-relay']),
  worker: z.string().regex(/^[a-z0-9-]+$/),
  image: z.string().optional(),
  imageDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/).optional(),
  /** Locally built images (no registry digest); built from browser-images/custom. */
  buildRecipe: z.string().optional(),
  driverVersion: z.string().min(1),
  sourceUrl: z.string().url(),
  /** Grid TOML this entry is written into ('default' or 'legacy'); Safari entries use none. */
  gridProfile: z.enum(['default', 'legacy', 'static', 'none']),
  maxConcurrentSessions: z.number().int().min(1).max(8),
  capabilities: z.object({
    screenshots: z.boolean(),
    windowResize: z.boolean(),
    uploads: z.boolean(),
    downloads: z.boolean(),
    clipboard: z.boolean(),
  }),
  /** Set only after a recorded, real interactive run on this worker (required for Safari readiness). */
  interactiveVerifiedAt: z.string().optional(),
  notes: z.string().optional(),
});
export type CatalogEntry = z.infer<typeof CatalogEntrySchema>;
export const CatalogSchema = z.object({ gridRelease: z.string(), entries: z.array(CatalogEntrySchema).min(1) });

/** Label for sessions on workers listed in BROWSERLAB_EMULATED_WORKERS (amd64 images on Apple Silicon via Docker's Rosetta). */
export const EMULATION_LABEL = 'amd64 emulated on Apple Silicon (Rosetta)';

export interface BrowserBuild extends CatalogEntry {
  /** Set when the worker serving this build runs it under CPU emulation. */
  emulation?: string;
  availability: Availability;
  reason: string;
  workerArch?: string;
  lastProbeAt?: string;
  activeSessions: number;
  lastVerifiedVersion?: string;
  lastVerifiedAt?: string;
}

export const ViewportSchema = z.object({
  width: z.number().int().min(320).max(1920),
  height: z.number().int().min(480).max(1080),
});
export const VIEWPORT_PRESETS = [
  { id: 'desktop', label: 'Desktop 1440×900', width: 1440, height: 900 },
  { id: 'laptop', label: 'Laptop 1366×768', width: 1366, height: 768 },
  { id: 'small', label: 'Small 1024×768', width: 1024, height: 768 },
  { id: 'mobile-sized', label: 'Desktop browser at mobile-sized viewport 390×844 (not phone emulation)', width: 390, height: 844 },
] as const;

export const TargetSchema = z.union([
  z.object({ catalogId: z.string() }),
  z.object({ family: z.enum(FAMILIES), strategy: z.literal('newest-provisioned') }),
  z.object({ family: z.enum(FAMILIES), strategy: z.literal('minimum'), projectId: z.string() }),
]);

export const CreateSessionSchema = z.object({
  targetUrl: z.string().max(2048),
  target: TargetSchema,
  viewport: ViewportSchema,
  projectId: z.string().optional(),
  environmentId: z.string().optional(),
  buildLabel: z.string().max(100).optional(),
  tester: z.string().max(60).optional(),
});
export type CreateSession = z.infer<typeof CreateSessionSchema>;

export const ResultSchema = z.object({
  outcome: z.enum(OUTCOMES),
  notes: z.string().max(20000).default(''),
  checklist: z.string().max(20000).default(''),
  tester: z.string().max(60).optional(),
});

export const ProjectSchema = z.object({ name: z.string().trim().min(1).max(120), description: z.string().max(2000).default('') });
export const EnvironmentSchema = z.object({
  name: z.string().trim().min(1).max(80),
  baseUrl: z.string().max(2048),
  isDefault: z.boolean().default(false),
});
export const PolicyTargetSchema = z.object({
  family: z.enum(FAMILIES),
  channel: z.enum(['stable', 'esr', 'beta']),
  requestedVersion: z.string().min(1).max(40),
  targetOs: z.enum(['linux', 'mac']),
  kind: z.enum(['minimum', 'exact', 'newest-provisioned']),
  required: z.boolean().default(true),
});
export type PolicyTarget = z.infer<typeof PolicyTargetSchema>;
export const PolicySchema = z.object({ targets: z.array(PolicyTargetSchema).max(100) });

export const ProjectExportSchema = z.object({
  format: z.literal('browserlab-project/v1'),
  project: ProjectSchema,
  environments: z.array(EnvironmentSchema).max(50),
  policy: PolicySchema,
});

/** Layered browser-identity evidence captured at session start. */
export interface Verification {
  level: 'executable' | 'capabilities' | 'none';
  ok: boolean;
  mismatches: string[];
  provenance: { catalogId: string; image?: string; imageDigest?: string; sourceUrl: string; buildRecipe?: string };
  capabilities: { browserName?: string; browserVersion?: string; platformName?: string; driverVersion?: string; buildId?: string; nodeArch?: string };
  executable?: { product?: string; version?: string; channel?: string; officialBuild?: boolean; path?: string };
  supplementary?: { uaBrands?: string[]; navigatorPlatform?: string };
  /** Present when the browser ran under CPU emulation; the browser build itself is unchanged. */
  emulation?: string;
}

export interface SessionView {
  id: string;
  state: SessionState;
  driver: 'attached' | 'detached' | 'none';
  catalogId: string;
  family: Family;
  brand: string;
  requestedVersion: string;
  actualBrowserVersion: string | null;
  actualOs: string | null;
  actualArch: string | null;
  emulation: string | null;
  targetUrl: string;
  currentUrl?: string | null;
  projectId: string | null;
  environmentId: string | null;
  buildLabel: string | null;
  tester: string | null;
  viewport: { width: number; height: number };
  effectiveViewport: { width: number; height: number } | null;
  startedAt: string;
  endedAt: string | null;
  lastActivityAt: string;
  expiresAt: string | null;
  failureCode: string | null;
  failureMessage: string | null;
  verification: Verification | null;
  result: { outcome: Outcome; notes: string; checklist: string; tester: string | null; checkedAt: string } | null;
  evidenceCount: number;
  capabilities: CatalogEntry['capabilities'];
}
