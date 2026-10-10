import {
  AuditEntrySchema,
  ConnectorSettingsSchema,
  DEFAULT_CONNECTOR_SETTINGS,
  DEFAULT_RISK_RULES,
  RiskRulesSchema,
  redactArgs,
  type Actor,
  type AuditEntry,
  type ConnectorSettings,
  type RiskRules,
} from '../schemas/index';
import { nowIso, type Firestore } from './firestore';

// ─────────────────────────────────────────────────────────────────────────────
// Risk rules
// ─────────────────────────────────────────────────────────────────────────────

const CONFIG = 'config';
const RISK_RULES_DOC = 'riskRules';

/**
 * The rules currently in force.
 *
 * Falls back to `DEFAULT_RISK_RULES` when the document is absent, so a fresh
 * project scores students correctly before anyone visits the Risk Rules page.
 */
export async function getRiskRules(db: Firestore): Promise<RiskRules> {
  const snap = await db.collection(CONFIG).doc(RISK_RULES_DOC).get();
  if (!snap.exists) return DEFAULT_RISK_RULES;
  return RiskRulesSchema.parse(snap.data());
}

/**
 * Saves edited rules, bumping `rulesVersion`.
 *
 * The bump is unconditional and server-side: every snapshot records the
 * version that produced it, so comparing a score computed under v1 with one
 * computed under v2 is meaningless unless the version is visible. Letting a
 * caller choose the version would break that guarantee.
 *
 * Callers are expected to follow this with a full recompute — the dashboard's
 * "Recalculate all" button — otherwise the cohort is scored under mixed rules.
 */
export async function saveRiskRules(
  db: Firestore,
  rules: Omit<RiskRules, 'rulesVersion'>,
  updatedBy: string,
): Promise<RiskRules> {
  const ref = db.collection(CONFIG).doc(RISK_RULES_DOC);

  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const currentVersion = snap.exists
      ? (RiskRulesSchema.parse(snap.data()).rulesVersion ?? 0)
      : 0;

    const next = RiskRulesSchema.parse({
      ...rules,
      rulesVersion: currentVersion + 1,
      updatedAt: nowIso(),
      updatedBy,
    });

    tx.set(ref, next);
    return next;
  });
}

/** Writes the default rules if none exist. Used by the seed script. */
export async function ensureRiskRules(db: Firestore): Promise<RiskRules> {
  const ref = db.collection(CONFIG).doc(RISK_RULES_DOC);
  const snap = await ref.get();
  if (snap.exists) return RiskRulesSchema.parse(snap.data());
  const rules = { ...DEFAULT_RISK_RULES, updatedAt: nowIso(), updatedBy: 'seed' };
  await ref.set(rules);
  return rules;
}

// ─────────────────────────────────────────────────────────────────────────────
// Audit log
// ─────────────────────────────────────────────────────────────────────────────

const AUDIT = 'audit';

export interface AuditInput {
  actor: Actor;
  tool: string;
  args: unknown;
  status: AuditEntry['status'];
  errorMessage?: string | null;
  durationMs?: number;
}

/**
 * Appends an audit row.
 *
 * Writes refusals as well as successes — `permission_denied` rows are the
 * evidence that an agent's allowlist is actually enforced, which is exactly
 * what a reviewer asks to see.
 *
 * Deliberately never throws: an audit failure must not take down the tool call
 * it was recording. A dropped log line is bad; a failed intervention because
 * logging broke is worse.
 */
export async function writeAudit(db: Firestore, input: AuditInput): Promise<void> {
  try {
    const ref = db.collection(AUDIT).doc();
    const entry = AuditEntrySchema.parse({
      auditId: ref.id,
      actor: input.actor,
      tool: input.tool,
      args: redactArgs(input.args),
      status: input.status,
      errorMessage: input.errorMessage ?? null,
      durationMs: input.durationMs,
      at: nowIso(),
    });
    await ref.set(entry);
  } catch (error) {
    console.error('[audit] failed to record tool call', input.tool, error);
  }
}

export async function listAudit(db: Firestore, limit = 50): Promise<AuditEntry[]> {
  const snap = await db.collection(AUDIT).orderBy('at', 'desc').limit(limit).get();
  return snap.docs.map((d) => AuditEntrySchema.parse(d.data()));
}

// ─────────────────────────────────────────────────────────────────────────────
// Connector settings
// ─────────────────────────────────────────────────────────────────────────────

const CONNECTORS_DOC = 'connectors';

/**
 * Which tools are switched off, read fresh on every tool call.
 *
 * Deliberately not cached. "Disconnecting a connector removes its tools from
 * the agent immediately" is only true if the check sees the current value, and
 * a cache measured in minutes would make the demo — and the guarantee — a lie.
 * It is one document read against a tool call that is about to do far more.
 */
export async function getConnectorSettings(db: Firestore): Promise<ConnectorSettings> {
  const snap = await db.collection(CONFIG).doc(CONNECTORS_DOC).get();
  if (!snap.exists) return DEFAULT_CONNECTOR_SETTINGS;
  return ConnectorSettingsSchema.parse(snap.data());
}

/** Turns one tool on or off for every agent. */
export async function setToolEnabled(
  db: Firestore,
  toolName: string,
  enabled: boolean,
  updatedBy: string,
): Promise<ConnectorSettings> {
  const ref = db.collection(CONFIG).doc(CONNECTORS_DOC);

  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const current = snap.exists
      ? ConnectorSettingsSchema.parse(snap.data())
      : DEFAULT_CONNECTOR_SETTINGS;

    const disabled = new Set(current.disabledTools);
    if (enabled) disabled.delete(toolName);
    else disabled.add(toolName);

    const next = ConnectorSettingsSchema.parse({
      disabledTools: [...disabled].sort(),
      updatedAt: nowIso(),
      updatedBy,
    });
    tx.set(ref, next);
    return next;
  });
}
