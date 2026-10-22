import type { DB } from '../db/index.ts';
import type { Config } from '../config.ts';
import type { Catalog } from '../services/catalog.ts';
import type { SessionService } from '../services/sessions.ts';
import type { EvidenceStore } from '../services/evidence.ts';

export interface Ctx { db: DB; cfg: Config; catalog: Catalog; sessions: SessionService; evidence: EvidenceStore }
