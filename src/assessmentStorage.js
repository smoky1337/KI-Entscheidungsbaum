export const ASSESSMENTS_STORAGE_KEY = 'aiDecisionTreeAssessments';
export const ASSESSMENT_SCHEMA_VERSION = 'assessment-schema-v1';
export const APP_VERSION = '0.0.0';

/**
 * Erzeugt eine stabile lokale Assessment-ID ohne Backend-Abhängigkeit.
 */
export function createAssessmentId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  return `assessment-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Liest alle lokal gespeicherten Assessments als Array.
 */
export function listSavedAssessments() {
  return Object.values(readAssessmentStore()).sort((a, b) =>
    String(b.updatedAt ?? '').localeCompare(String(a.updatedAt ?? ''))
  );
}

/**
 * Persistiert ein Assessment unter seiner Assessment-ID.
 */
export function saveAssessment(assessment) {
  const normalized = normalizeAssessment(assessment);
  const store = readAssessmentStore();
  store[normalized.assessmentId] = normalized;
  writeAssessmentStore(store);
  return normalized;
}

/**
 * Entfernt ein gespeichertes Assessment.
 */
export function deleteAssessment(assessmentId) {
  const store = readAssessmentStore();
  delete store[assessmentId];
  writeAssessmentStore(store);
}

/**
 * Lädt ein einzelnes Assessment aus dem lokalen Store.
 */
export function getSavedAssessment(assessmentId) {
  return readAssessmentStore()[assessmentId] ?? null;
}

/**
 * Normalisiert importierte oder neu erzeugte Assessments auf das aktuelle Schema.
 */
export function normalizeAssessment(assessment = {}) {
  const now = new Date().toISOString();
  const assessmentId = assessment.assessmentId || createAssessmentId();

  return {
    schemaVersion: assessment.schemaVersion || ASSESSMENT_SCHEMA_VERSION,
    assessmentId,
    title: String(assessment.title || 'Untitled assessment'),
    createdBy: String(assessment.createdBy || ''),
    createdAt: assessment.createdAt || now,
    updatedAt: assessment.updatedAt || now,
    locale: assessment.locale || 'de',
    revision: assessment.revision || 'v1.0',
    modelVersion: assessment.modelVersion || 'unknown-model',
    appVersion: assessment.appVersion || APP_VERSION,
    path: Array.isArray(assessment.path) && assessment.path.length
      ? assessment.path.map((step) => ({ id: String(step?.id ?? '') })).filter((step) => step.id)
      : [{ id: 'A1' }],
    answers: isPlainObject(assessment.answers) ? assessment.answers : {},
    currentStepIndex: Number.isInteger(assessment.currentStepIndex)
      ? Math.max(0, assessment.currentStepIndex)
      : 0,
    activePathLength: Number.isInteger(assessment.activePathLength)
      ? Math.max(1, assessment.activePathLength)
      : 1,
  };
}

/**
 * Prüft die minimale Struktur für JSON-Importe.
 */
export function validateImportedAssessment(value) {
  if (!isPlainObject(value)) {
    return { ok: false, error: 'Imported file does not contain an assessment object.' };
  }

  if (!Array.isArray(value.path) || value.path.length === 0) {
    return { ok: false, error: 'Imported assessment is missing a non-empty path array.' };
  }

  if (!isPlainObject(value.answers)) {
    return { ok: false, error: 'Imported assessment is missing an answers object.' };
  }

  return { ok: true };
}

/**
 * Erstellt einen Dateinamen für JSON-Exporte.
 */
export function buildAssessmentFileName(assessment) {
  const title = safeFilePart(assessment?.title || 'assessment');
  const revision = safeFilePart(assessment?.revision || 'v1.0');
  return `${title}-${revision}.json`;
}

function readAssessmentStore() {
  try {
    const raw = window.localStorage.getItem(ASSESSMENTS_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return isPlainObject(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function writeAssessmentStore(store) {
  window.localStorage.setItem(ASSESSMENTS_STORAGE_KEY, JSON.stringify(store));
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function safeFilePart(value) {
  return String(value ?? 'assessment')
    .trim()
    .replace(/[^\w.-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80) || 'assessment';
}
