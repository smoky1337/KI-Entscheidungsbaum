
import { Component, useCallback, useMemo, useRef, useState, useEffect } from 'react';

// Modell-/Regellogik (Entscheidungsbaum + Katalog + Helper):
// - decisionTree: Fragen-/Leaf-Knoten inkl. next-Verweisen und ausgelösten Pflichtenpaketen
// - obligationsCatalog: Pflichtenpakete mit konkreten Requirement-Items (Fragen, ToDos)
// - getRequirementChain / getNextInRequirementChain: baut pro Leaf eine sequenzielle Requirement-Prüfung auf
// - validateNextNode: zentrale Gate-/Lock-Logik (Review, Konsistenz, Sonderpfade)
// - getCanonicalIdForRequirementInstance: Deduplizierung von Requirements über mehrere Leaves hinweg
import {
  MODEL_VERSION,
  getLocalizedModel,
  getRequirementChain,
  getNextInRequirementChain,
  validateNextNode,
  getCanonicalIdForRequirementInstance,
} from './decisionTreeModel';
import {
  APP_VERSION,
  buildAssessmentFileName,
  createAssessmentId,
  deleteAssessment,
  listSavedAssessments,
  normalizeAssessment,
  saveAssessment,
  validateImportedAssessment,
} from './assessmentStorage';

import { exportAssessmentPdf } from './pdfExport';
import {
  createTranslator,
  DEFAULT_LOCALE,
  LOCALE_STORAGE_KEY,
  SUPPORTED_LOCALES,
} from './i18n';

// UI-Styles werden als String gebündelt und im App-Root via <style>{uiCSS}</style> injiziert
// Vorteil für die Masterarbeit: reproduzierbare Darstellung ohne Build- oder CSS-Tooling-Abhängigkeiten

const uiCSS = `
.app-root{
  width:100vw;
  height:100vh;
  overflow:hidden;
  background:#f3f4f6;
  color:#111827;
  font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}

/* Header */
.app-header{
  position:fixed;
  top:0; left:0; right:0;
  height:64px;
  display:grid;
  grid-template-columns:minmax(260px, 1fr) auto minmax(300px, 1fr);
  align-items:center;
  gap:16px;
  padding:0 16px;
  background:#f9fafb;
  border-bottom:1px solid #e5e7eb;
  box-shadow:0 2px 6px rgba(15,23,42,0.04);
  z-index:1000;
}

.app-header-left,
.app-header-center,
.app-header-right{
  display:flex;
  align-items:center;
  gap:8px;
  min-width:0;
}

.app-header-center{
  justify-content:center;
  min-width:0;
}

.app-header-left{
  justify-content:flex-start;
  overflow:hidden;
}

.app-header-right{
  justify-content:flex-end;
}

.app-model-badge{
  padding:2px 8px;
  border-radius:999px;
  border:1px solid #d1d5db;
  background:#e5e7eb;
  font-size:11px;
  font-weight:500;
  white-space:nowrap;
  flex:0 0 auto;
}

.app-assessment-pill{
  display:flex;
  align-items:center;
  gap:6px;
  min-width:140px;
  max-width:360px;
  padding:6px 10px;
  border-radius:10px;
  border:1px solid #bae6fd;
  background:#e0f2fe;
  color:#0f172a;
  box-shadow:0 1px 3px rgba(15,23,42,0.08);
}

.app-assessment-label{
  font-size:10px;
  font-weight:800;
  text-transform:uppercase;
  color:#0369a1;
  white-space:nowrap;
}

.app-assessment-name{
  min-width:0;
  overflow:hidden;
  text-overflow:ellipsis;
  white-space:nowrap;
  font-size:14px;
  font-weight:800;
}

.app-title{
  font-size:18px;
  font-weight:600;
  color:#111827;
  text-align:center;
  white-space:nowrap;
  overflow:hidden;
  text-overflow:ellipsis;
  max-width:min(38vw, 520px);
}

.app-actions{
  display:flex;
  align-items:center;
  gap:8px;
  min-width:0;
}

.app-actions button,
.app-menu-button,
.app-menu-item{
  font-size:12px;
  padding:6px 12px;
  border-radius:999px;
  border:1px solid #d1d5db;
  background:#ffffff;
  color:#111827;
  cursor:pointer;
}

.app-actions button:hover,
.app-menu-button:hover,
.app-menu-item:hover{
  background:#f3f4f6;
}

.app-actions button:disabled,
.app-menu-item:disabled{
  background:#e5e7eb;
  color:#6b7280;
  cursor:not-allowed;
}

.app-meta-stack{
  display:flex;
  align-items:center;
  gap:8px;
  min-width:0;
  overflow:hidden;
}

.app-meta-truncate{
  overflow:hidden;
  text-overflow:ellipsis;
  white-space:nowrap;
  min-width:0;
}

.app-menu{
  position:relative;
  flex:0 0 auto;
}

.app-menu-panel{
  position:absolute;
  top:calc(100% + 8px);
  right:0;
  min-width:190px;
  padding:6px;
  border:1px solid #d1d5db;
  border-radius:10px;
  background:#ffffff;
  box-shadow:0 16px 36px rgba(15,23,42,0.16);
  z-index:2200;
}

.app-menu-item{
  display:block;
  width:100%;
  border-radius:8px;
  text-align:left;
  white-space:nowrap;
  border:1px solid transparent;
  box-shadow:none;
}

@media (max-width: 1100px){
  .app-header{
    grid-template-columns:minmax(180px, 1fr) auto minmax(220px, 1fr);
    gap:10px;
    padding:0 10px;
  }

  .app-title{
    max-width:28vw;
    font-size:16px;
  }

  .app-header-left .rf-meta,
  .app-header-right > .rf-meta{
    display:none;
  }

  .app-assessment-pill{
    max-width:240px;
  }
}


/* Main-Container unterhalb des Headers */
.app-body{
  position:absolute;
  top:64px;
  left:0;
  right:0;
  bottom:0;
  display:flex;
  min-height:0;
}

/* Sidebar (wie bisher, nur als Klasse statt inline) */
.app-sidebar{
  width:260px;
  border-right:1px solid #e2e8f0;
  padding:16px 12px;
  overflow-y:auto;
  background:#f8fafc;
}

/* Main Content */
.app-main{
  flex:1;
  display:flex;
  justify-content:center;
  align-items:flex-start;
  overflow:auto;
  background:#f3f4f6;
}
.app-main-inner{
  width:100%;
  max-width:960px;
  padding:24px 32px 32px;
}

/* Bestehende Badge-/Tooltip-Styles bitte beibehalten */
.rf-meta{ font-size:11px; opacity:0.8; }
.rf-badge{
  display:inline-block; font-size:11px; padding:2px 8px;
  border:1px solid #cbd5e1; border-radius:999px; background:#f8fafc;
  white-space:nowrap;
  flex: 0 0 auto;
}

.rf-tt{ position:relative; display:inline-block; }
.rf-tt-panel{
  display:none; position:absolute; z-index:9999;
  top:120%; left:0;
  width:360px; padding:10px; border-radius:10px;
  border:1px solid #e2e8f0; background:white;
  box-shadow:0 12px 30px rgba(0,0,0,0.14);
}
.rf-tt:hover .rf-tt-panel{ display:block; }

/* Step-Badge in Cards */
.step-badge{
  position:absolute; top:-10px; right:-10px; background:#111827; color:#fff;
  font-size:11px; font-weight:800; border-radius:999px; width:24px; height:24px;
  display:flex; align-items:center; justify-content:center;
  box-shadow:0 2px 6px rgba(0,0,0,0.14);
}
`;

/**
 * Fängt Render-/Lifecycle-Fehler im Wizard ab und zeigt eine kontrollierte Fehlermeldung inkl. Stack
 * Damit bleibt das Tool in der Bewertungssituation nutzbar und Fehler sind für Reviewer nachvollziehbar
 */
class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    this.setState({ errorInfo });
    console.error('UI crashed (caught by ErrorBoundary):', error, errorInfo);
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null, errorInfo: null });
    this.props.onReset?.();
  };

  render() {
    if (!this.state.hasError) return this.props.children;

    const message =
      this.state.error?.message || this.props.messages?.unknownError;
    const stack =
      this.state.errorInfo?.componentStack ||
      this.state.error?.stack ||
      '';

    return (
      <div className="app-root">
        <div style={{ maxWidth: 920, margin: '80px auto', padding: 24 }}>
          <div
            style={{
              background: '#fff',
              border: '1px solid #e5e7eb',
              borderRadius: 16,
              padding: 20,
              boxShadow: '0 8px 22px rgba(15,23,42,0.06)',
            }}
          >
            <h2 style={{ margin: 0, fontSize: 20 }}>
              {this.props.messages?.title}
            </h2>
            <p style={{ marginTop: 10, marginBottom: 14, color: '#334155' }}>
              {message}
            </p>

            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <button
                className="btn"
                onClick={this.handleReset}
                type="button"
              >
                {this.props.messages?.reset}
              </button>
              <button
                className="btn btn-ghost"
                onClick={() => window.location.reload()}
                type="button"
              >
                {this.props.messages?.reload}
              </button>
            </div>

            {stack ? (
              <details style={{ marginTop: 14 }}>
                <summary style={{ cursor: 'pointer' }}>
                  {this.props.messages?.details}
                </summary>
                <pre
                  style={{
                    marginTop: 10,
                    whiteSpace: 'pre-wrap',
                    background: '#0b1220',
                    color: '#e2e8f0',
                    padding: 12,
                    borderRadius: 12,
                    overflowX: 'auto',
                    fontSize: 12,
                  }}
                >
                  {String(stack)}
                </pre>
              </details>
            ) : null}
          </div>
        </div>
      </div>
    );
  }
}

/**
 * Kleine Sprachumschaltung für Welcome-, Creator- und Wizard-Ansicht.
 */
function LanguageSwitcher({ locale, onChange, t }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <span className="rf-meta">{t('common.language')}:</span>
      <div style={{ display: 'flex', gap: 6 }}>
        {SUPPORTED_LOCALES.map((lang) => {
          const isActive = lang === locale;
          return (
            <button
              key={lang}
              type="button"
              onClick={() => onChange(lang)}
              style={{
                padding: '4px 10px',
                borderRadius: 999,
                border: '1px solid #d1d5db',
                background: isActive ? '#0ea5e9' : '#ffffff',
                color: '#0f172a',
                fontSize: 12,
                fontWeight: isActive ? 700 : 500,
                cursor: isActive ? 'default' : 'pointer',
              }}
              disabled={isActive}
            >
              {t(`languages.${lang}`)}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Rendert ein kompaktes Header-Menü für gruppierte Wizard-Aktionen.
 */
function HeaderActionMenu({ id, label, openMenu, setOpenMenu, items }) {
  const isOpen = openMenu === id;

  return (
    <div className="app-menu">
      <button
        type="button"
        className="app-menu-button"
        onClick={() => setOpenMenu(isOpen ? null : id)}
      >
        {label}
      </button>

      {isOpen && (
        <div className="app-menu-panel">
          {items.map((item) => (
            <button
              key={item.key}
              type="button"
              className="app-menu-item"
              onClick={() => {
                setOpenMenu(null);
                item.onClick?.();
              }}
              disabled={item.disabled}
              title={item.title}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Zeigt lokal gespeicherte Assessments und erlaubt Laden/Löschen.
 */
function SavedAssessmentDialog({
  assessments,
  currentAssessmentId,
  locale,
  onClose,
  onLoad,
  onDelete,
  t,
}) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 2000,
        background: 'rgba(15,23,42,0.45)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 20,
      }}
      onClick={onClose}
    >
      <div
        style={{
          width: 'min(840px, 100%)',
          maxHeight: '82vh',
          overflow: 'auto',
          background: '#ffffff',
          borderRadius: 14,
          border: '1px solid #e5e7eb',
          boxShadow: '0 24px 60px rgba(15,23,42,0.25)',
          padding: 18,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginBottom: 14 }}>
          <div>
            <div style={{ fontWeight: 800, fontSize: 16 }}>{t('persistence.managerTitle')}</div>
            <div className="rf-meta">{t('persistence.managerDescription')}</div>
          </div>
          <button
            type="button"
            onClick={onClose}
            style={{
              padding: '6px 10px',
              borderRadius: 10,
              border: '1px solid #d1d5db',
              background: '#ffffff',
              cursor: 'pointer',
              height: 'fit-content',
            }}
          >
            {t('common.close')}
          </button>
        </div>

        {assessments.length === 0 ? (
          <div
            style={{
              padding: 14,
              borderRadius: 10,
              border: '1px solid #e5e7eb',
              background: '#f9fafb',
              fontSize: 13,
            }}
          >
            {t('persistence.noSavedAssessments')}
          </div>
        ) : (
          <div style={{ display: 'grid', gap: 10 }}>
            {assessments.map((assessment) => (
              <div
                key={assessment.assessmentId}
                style={{
                  border: '1px solid #e5e7eb',
                  borderRadius: 10,
                  padding: 12,
                  background: assessment.assessmentId === currentAssessmentId ? '#eff6ff' : '#ffffff',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 700, marginBottom: 4 }}>
                      {assessment.title || t('persistence.untitled')}
                    </div>
                    <div className="rf-meta" style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
                      <span>{t('persistence.creatorMeta', { value: assessment.createdBy || t('common.unknown') })}</span>
                      <span>{t('persistence.updatedMeta', { value: new Date(assessment.updatedAt).toLocaleString(locale === 'en' ? 'en-US' : 'de-DE') })}</span>
                      <span>{t('persistence.revisionMeta', { value: assessment.revision || 'v1.0' })}</span>
                      <span>{t('persistence.localeMeta', { value: assessment.locale || '-' })}</span>
                      <span>{t('persistence.modelMeta', { value: assessment.modelVersion || 'unknown' })}</span>
                    </div>
                  </div>

                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                    <button
                      type="button"
                      onClick={() => onLoad(assessment)}
                      style={{
                        padding: '6px 10px',
                        borderRadius: 10,
                        border: '1px solid #0ea5e9',
                        background: '#e0f2fe',
                        cursor: 'pointer',
                        fontSize: 12,
                        fontWeight: 600,
                      }}
                    >
                      {t('persistence.load')}
                    </button>
                    <button
                      type="button"
                      onClick={() => onDelete(assessment.assessmentId)}
                      style={{
                        padding: '6px 10px',
                        borderRadius: 10,
                        border: '1px solid #fecaca',
                        background: '#fff1f2',
                        cursor: 'pointer',
                        fontSize: 12,
                      }}
                    >
                      {t('persistence.delete')}
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Startbildschirm: Kontext + Einstieg in den Wizard-Flow
 * Verantwortlich nur für UI und Übergang via onStart
 */
function WelcomeScreen({ onStart, onLoad, onImport, locale, onLocaleChange, t }) {
  return (
    <div
      style={{
        width: '100vw',
        height: '100vh',
        background: '#0f172a',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
      }}
    >

      <div
        style={{
          maxWidth: 820,
          width: '100%',
          background: '#ffffff',
          borderRadius: 16,
          padding: '28px 32px',
          boxShadow: '0 18px 45px rgba(15,23,42,0.45)',
          color: '#0f172a',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
          <LanguageSwitcher locale={locale} onChange={onLocaleChange} t={t} />
        </div>

        <div style={{ marginBottom: 16 }}>
          <div
            style={{
              fontSize: 13,
              fontWeight: 600,
              color: '#0ea5e9',
              textTransform: 'uppercase',
              letterSpacing: 0.06,
            }}
          >
            {t('welcome.badge')}
          </div>

          <h1 style={{ margin: '6px 0 4px', fontSize: 24 }}>
            {t('welcome.title')}
          </h1>

          <p style={{ margin: 0, fontSize: 14, color: '#4b5563' }}>
            {t('welcome.description')}
          </p>
        </div>

        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: 16,
            marginBottom: 18,
            marginTop: 6,
          }}
        >
          <div style={{ flex: '1 1 260px' }}>
            <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 6 }}>{t('welcome.expectTitle')}</div>
            <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, color: '#374151' }}>
              <li>{t('welcome.expectItem1')}</li>
              <li>{t('welcome.expectItem2')}</li>
              <li>{t('welcome.expectItem3')}</li>
            </ul>
          </div>

          <div style={{ flex: '1 1 260px' }}>
            <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 6 }}>{t('welcome.featuresTitle')}</div>
            <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, color: '#374151' }}>
              <li>{t('welcome.featuresItem1')}</li>
              <li>{t('welcome.featuresItem2')}</li>
              <li>{t('welcome.featuresItem3')}</li>
            </ul>
          </div>
        </div>

        <div
          style={{
            padding: '10px 12px',
            borderRadius: 10,
            border: '1px solid #e5e7eb',
            background: '#f9fafb',
            fontSize: 12,
            color: '#4b5563',
            marginBottom: 18,
          }}
        >
          <strong>{t('welcome.notePrefix')}</strong> {t('welcome.noteText')}
        </div>

        <div
          style={{
            padding: '12px 14px',
            borderRadius: 10,
            border: '1px solid #e5e7eb',
            background: '#f8fafc',
            fontSize: 13,
            color: '#334155',
            marginBottom: 18,
            lineHeight: 1.4,
          }}
        >
          <div style={{ fontWeight: 700, marginBottom: 4 }}>
            {t('welcome.durationTitle')}
          </div>
          <div style={{ fontSize: 12, color: '#475569' }}>
            {t('welcome.durationSubline')}
          </div>
          <div style={{ marginTop: 8, fontSize: 12, color: '#64748b' }}>
            {t('welcome.durationText')}
          </div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, marginTop: 4 }}>
          <div className="rf-meta">{t('welcome.auditTrail')}</div>

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            <button
              type="button"
              onClick={onLoad}
              style={{
                padding: '8px 14px',
                borderRadius: 999,
                border: '1px solid #d1d5db',
                background: '#ffffff',
                color: '#0f172a',
                fontWeight: 600,
                fontSize: 13,
                cursor: 'pointer',
              }}
            >
              {t('welcome.load')}
            </button>

            <button
              type="button"
              onClick={onImport}
              style={{
                padding: '8px 14px',
                borderRadius: 999,
                border: '1px solid #d1d5db',
                background: '#ffffff',
                color: '#0f172a',
                fontWeight: 600,
                fontSize: 13,
                cursor: 'pointer',
              }}
            >
              {t('welcome.import')}
            </button>

            <button
              type="button"
              onClick={onStart}
              style={{
                padding: '8px 18px',
                borderRadius: 999,
                border: 'none',
                background: '#0ea5e9',
                color: '#0f172a',
                fontWeight: 600,
                fontSize: 13,
                cursor: 'pointer',
                boxShadow: '0 8px 18px rgba(56,189,248,0.45)',
              }}
            >
              {t('welcome.start')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Erfasst den "Ersteller" (Name/Team) als Metadatum für Header und Export
 * Validierung ist bewusst minimal (nicht-leerer String), um den Flow nicht zu blockieren
 */
function CreatorScreen({
  creator,
  onCreatorChange,
  title,
  onTitleChange,
  requireTitle,
  onBack,
  onConfirm,
  locale,
  onLocaleChange,
  t,
}) {
  const isValid = creator.trim().length > 0 && (!requireTitle || title.trim().length > 0);

  return (
    <div
      className="creator-wrapper"
      style={{
        width: "100vw",
        height: "100vh",
        background: "#0f172a",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
      }}
    >

      <div
        className="creator-card"
        style={{
          maxWidth: 520,
          width: "100%",
          background: "#ffffff",
          borderRadius: 16,
          padding: "24px 28px",
          boxShadow: "0 18px 45px rgba(15,23,42,0.45)",
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
          <LanguageSwitcher locale={locale} onChange={onLocaleChange} t={t} />
        </div>

        <h2
          className="creator-title"
          style={{ marginTop: 0, marginBottom: 8, fontSize: 20, color: "#0f172a" }}
        >
          {t('creator.title')}
        </h2>

        <p
          className="creator-text"
          style={{ marginTop: 0, marginBottom: 16, fontSize: 13, color: "#4b5563" }}
        >
          {t('creator.description')}
        </p>

        <label
          className="creator-label"
          style={{ display: "block", fontSize: 13, marginBottom: 6, color: "#0f172a" }}
        >
          {t('creator.label')}
        </label>

        <input
          className="creator-input"
          type="text"
          value={creator}
          onChange={(e) => onCreatorChange(e.target.value)}
          style={{
            width: "100%",
            padding: "8px 10px",
            borderRadius: 8,
            border: "1px solid #d1d5db",
            fontSize: 13,
            marginBottom: 18,
            background: "#ffffff",
            color: "#0f172a",
          }}
        />

        {requireTitle ? (
          <>
            <label
              className="creator-label"
              style={{ display: "block", fontSize: 13, marginBottom: 6, color: "#0f172a" }}
            >
              {t('creator.assessmentTitleLabel')}
            </label>

            <input
              className="creator-input"
              type="text"
              value={title}
              onChange={(e) => onTitleChange(e.target.value)}
              placeholder={t('creator.assessmentTitlePlaceholder')}
              style={{
                width: "100%",
                padding: "8px 10px",
                borderRadius: 8,
                border: "1px solid #d1d5db",
                fontSize: 13,
                marginBottom: 18,
                background: "#ffffff",
                color: "#0f172a",
              }}
            />
          </>
        ) : (
          <div
            style={{
              padding: '10px 12px',
              borderRadius: 10,
              border: '1px solid #e5e7eb',
              background: '#f8fafc',
              fontSize: 13,
              color: '#334155',
              marginBottom: 18,
            }}
          >
            <div style={{ fontWeight: 700, marginBottom: 3 }}>
              {t('creator.loadedAssessment')}
            </div>
            <div>{title || t('persistence.untitled')}</div>
          </div>
        )}

        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 8,
          }}
        >
          <button
            className="creator-btn creator-btn-back"
            type="button"
            onClick={onBack}
            style={{
              padding: "6px 12px",
              borderRadius: 999,
              border: "1px solid #d1d5db",
              background: "#ffffff",
              color: "#0f172a",
              fontSize: 12,
              cursor: "pointer",
            }}
          >
            {t('common.back')}
          </button>

          <button
            className="creator-btn creator-btn-primary"
            type="button"
            onClick={onConfirm}
            disabled={!isValid}
            style={{
              padding: "6px 16px",
              borderRadius: 999,
              border: "1px solid #0ea5e9",
              background: isValid ? "#0ea5e9" : "#e5e7eb",
              color: isValid ? "#0f172a" : "#9ca3af",
              fontSize: 13,
              fontWeight: 600,
              cursor: isValid ? "pointer" : "not-allowed",
            }}
          >
            {t('creator.continue')}
          </button>
        </div>
      </div>
    </div>
  );
}

// Cluster dienen der visuellen Trennung zwischen EU AI Act und DORA
// Die Zuordnung erfolgt primär über node.cluster; als Fallback werden ausgelöste Pflichtenpakete ausgewertet
const CLUSTER_AI = 'AI Act';
const CLUSTER_DORA = 'DORA';

function getClusterForNodeId(id, decisionTree, obligationsCatalog) {
  const baseId = id.includes('__req__') ? id.split('__req__')[0] : id;
  const node = decisionTree[baseId];

  if (node?.cluster) return node.cluster;

  const obligationKeys = Array.isArray(node?.obligations) ? node.obligations : [];
  const hasDora = obligationKeys.some((k) => obligationsCatalog[k]?.regulation === 'DORA');
  if (hasDora) return CLUSTER_DORA;

  return CLUSTER_AI;
}

function ArticleLink({ label, url }) {
  if (!url) return <>{label}</>;
  return (
    <a className="rf-link" href={url} target="_blank" rel="noreferrer">
      {label}
    </a>
  );
}

function ReferenceInline({ reference, referenceUrl, t }) {
  if (!reference) return null;

  return (
    <div style={{ marginTop: 6, fontSize: 12, color: '#4b5563' }}>
      {t('common.reference')}{' '}
      {referenceUrl ? (
        <a className="rf-link" href={referenceUrl} target="_blank" rel="noreferrer">
          {reference}
        </a>
      ) : (
        <span>{reference}</span>
      )}
    </div>
  );
}

function decodeHtmlEntities(value) {
  const s = String(value ?? '');
  if (!s.includes('&')) return s;
  if (typeof document === 'undefined') return s;

  const el = document.createElement('textarea');
  el.innerHTML = s;
  return el.value;
}

function _escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => {
    const map = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    };
    return map[c] ?? c;
  });
}

function _normalizePdfText(value) {
  return decodeHtmlEntities(value).replace(/\u00A0/g, ' ');
}

const HINTS_STORAGE_KEY = 'rfShowHints';

function getStoredLocale() {
  try {
    const stored = window.localStorage.getItem(LOCALE_STORAGE_KEY);
    return SUPPORTED_LOCALES.includes(stored) ? stored : DEFAULT_LOCALE;
  } catch {
    return DEFAULT_LOCALE;
  }
}

function getStoredBool(key, fallback) {
  try {
    const v = window.localStorage.getItem(key);
    if (v == null) return fallback;
    return v === '1' || v === 'true';
  } catch {
    return fallback;
  }
}

function setStoredBool(key, value) {
  try {
    window.localStorage.setItem(key, value ? '1' : '0');
  } catch {
    return;
  }
}

/**
 * Löst einen Browser-Download für JSON-Daten aus.
 */
function downloadJsonFile(fileName, data) {
  const blob = new Blob([JSON.stringify(data, null, 2)], {
    type: 'application/json',
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

/**
 * Prüft, ob gespeicherte Pfad-IDs im aktuellen Modell noch existieren.
 */
function getMissingModelIds(assessment, decisionTree) {
  const missing = [];

  for (const step of assessment?.path ?? []) {
    const id = step?.id;
    if (!id || id.includes('__req__')) continue;
    if (!decisionTree[id]) missing.push(id);
  }

  return missing;
}

/**
 * Baut eine deduplizierte Sicht auf Requirement-Antworten für die Export-Leaves.
 */
function buildReqAnswerByCanonicalIdForLeaves({ answers, leavesInPath, getCanonicalIdForRequirementInstance }) {
  const m = new Map();

  for (const [id, a] of Object.entries(answers || {})) {
    if (!id.includes('__req__') || id.includes('__req__summary')) continue;
    if (a !== 'yes' && a !== 'no') continue;

    const leafId = id.split('__req__')[0];
    if (!leavesInPath.has(leafId)) continue;

    const canonicalId = getCanonicalIdForRequirementInstance(id) ?? id.split('__req__')[1];
    const prev = m.get(canonicalId);

    if (!prev) m.set(canonicalId, a);
    else if (prev !== a) m.set(canonicalId, 'no');
  }

  return m;
}

/**
 * Darstellung der jeweils "aktuellen" Einheit im Wizard:
 * - QuestionNode: Frage (Ja/Nein) mit Hinweisen/Beispielen
 * - LeafNode: Ergebnis-Knoten; zeigt ausgelöste Pflichtenpakete und startet den Requirement-Check
 * - ReqQuestionNode: einzelne Requirement-Frage aus einem Pflichtenpaket (Erfüllung Ja/Nein)
 * - ReqSummaryNode: Zusammenfassung offener Requirements pro Leaf inkl. "Weiter"-Navigation
 */
function QuestionNode({ data }) {
  const {label, onYes, onNo, yesLabel, noLabel, disabled, answer, step, cluster, info, examples, checkpointText, reference, referenceUrl, t
  } = data;

  const YES = yesLabel ?? t('common.yes');
  const NO = noLabel ?? t('common.no');

  const [showHints, setShowHints] = useState(() => getStoredBool(HINTS_STORAGE_KEY, true));

  const border =
    answer === 'yes'
      ? '2px solid #16a34a'
      : answer === 'no'
        ? '2px solid #dc2626'
        : '1px solid #888';

  const bg = cluster === CLUSTER_DORA ? '#eff6ff' : '#ffffff';

  const hasHints =
    (typeof info === 'string' && info.trim().length > 0) ||
    (Array.isArray(examples) && examples.length > 0);

  const nodeClassName = [
    'rf-node',
    'rf-node--question',
    cluster === CLUSTER_DORA ? 'rf-node--dora' : '',
    answer ? `rf-node--${answer}` : '',
  ].filter(Boolean).join(' ');

  return (
    <div
      className={nodeClassName}
      style={{
        position: 'relative',
        padding: '16px 20px',
        borderRadius: 10,
        border,
        background: bg,
        minWidth: 420,
        maxWidth: 640,
        boxShadow: '0 2px 10px rgba(0,0,0,0.12)',
        opacity: disabled ? 0.85 : 1,
      }}
    >
      <div className="step-badge">{step}</div>

      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'baseline' }}>
        <div style={{ fontWeight: 'bold', marginBottom: 8, fontSize: 15 }}>{label}</div>
        <span className="rf-badge">{cluster}</span>
      </div>

      <ReferenceInline reference={reference} referenceUrl={referenceUrl} t={t} />

      {answer && (
        <div style={{ marginTop: 6, fontSize: 12, color: '#111827' }}>
          <span style={{ fontWeight: 600 }}>{t('wizard.answerLabel')}</span>{' '}
          {answer === 'yes' ? YES : NO}
        </div>
      )}

      {checkpointText && (
        <div style={{ marginTop: 2, marginBottom: 10 }}>
          <div style={{ fontSize: 12, lineHeight: 1.35, color: '#111827' }}>{checkpointText}</div>
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 10 }}>
        <button
          className="rf-btn rf-btn--no"
          onClick={onNo}
          disabled={disabled}
          style={{
            padding: '6px 12px',
            borderRadius: 6,
            border: '1px solid #999',
            background: disabled ? '#f1f5f9' : '#f5f5f5',
            color: '#111827',
            cursor: disabled ? 'not-allowed' : 'pointer',
            fontSize: 13,
          }}
        >
          {NO}
        </button>

        <button
          className="rf-btn rf-btn--yes"
          onClick={onYes}
          disabled={disabled}
          style={{
            padding: '6px 12px',
            borderRadius: 6,
            border: '1px solid #16a34a',
            background: disabled ? '#e5f9ec' : '#e6fff0',
            color: '#111827',
            cursor: disabled ? 'not-allowed' : 'pointer',
            fontSize: 13,
          }}
        >
          {YES}
        </button>
      </div>

      {hasHints && (
        <div style={{ marginTop: 14 }}>
          <button
            className="rf-hints-toggle rf-btn rf-btn--info"
            type="button"
            onClick={() =>
              setShowHints((v) => {
                const next = !v;
                setStoredBool(HINTS_STORAGE_KEY, next);
                return next;
              })
            }
            style={{
              padding: '4px 10px',
              borderRadius: 6,
              border: '1px solid #cbd5e1',
              background: '#f8fafc',
              color: '#111827',
              fontSize: 11,
              cursor: 'pointer',
            }}
          >
            {showHints ? t('nodes.hideHints') : t('nodes.showHints')}
          </button>

          {showHints && (
            <div
              className="rf-hints-panel"
              style={{
                marginTop: 8,
                padding: 10,
                borderRadius: 8,
                border: '1px dashed #cbd5e1',
                background: '#f9fafb',
                color: '#111827',
                fontSize: 12,
              }}
            >
              {info && info.trim().length > 0 && (
                <p style={{ marginTop: 0, marginBottom: examples?.length ? 8 : 0 }}>{info}</p>
              )}
              {Array.isArray(examples) && examples.length > 0 && (
                <>
                  <div style={{ fontWeight: 600, marginBottom: 4 }}>{t('common.examples')}</div>
                  <ul style={{ margin: 0, paddingLeft: 18 }}>
                    {examples.map((ex, idx) => (
                      <li key={idx}>{ex}</li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function LeafNode({ data }) {
  const {
    label,
    obligationKeys = [],
    obligationsCatalog,
    nextId,
    onContinue,
    continueDisabled,
    onStartCheck,
    checkStarted,
    step,
    cluster,
    checkpointText,
    reference,
    referenceUrl,
    t,
  } = data;

  const packs = useMemo(
    () =>
      obligationKeys.map((key) => ({
        key,
        label: obligationsCatalog[key]?.label ?? key,
        articles: obligationsCatalog[key]?.articles ?? [],
      })),
    [obligationKeys, obligationsCatalog]
  );

  const btnNextLabel =
    nextId === 'D0'
      ? t('nodes.leaf.goToDora')
      : nextId === 'ENDE'
        ? t('nodes.leaf.finish')
        : t('common.continue');

  const rootClass = [
    'rf-node',
    'rf-node--leaf',
    cluster === CLUSTER_DORA ? 'is-dora' : 'is-ai',
  ].join(' ');

  return (
    <div
      className={rootClass}
      style={{
        position: 'relative',
        padding: '16px 20px',
        borderRadius: 10,
        border: '1px solid #4a7',
        background: cluster === CLUSTER_DORA ? '#e0f2fe' : '#e9fff1',
        minWidth: 420,
        maxWidth: 640,
        boxShadow: '0 2px 10px rgba(0,0,0,0.12)',
        color: '#111827',
      }}
    >
      <div className="step-badge">{step}</div>

      {obligationKeys.includes('KI_VERBOTENE_PRAKTIKEN') && (
        <div
          style={{
            marginBottom: 10,
            padding: 10,
            borderRadius: 10,
            border: '1px solid #ef4444',
            background: '#fef2f2',
          }}
        >
          <div style={{ fontWeight: 800, marginBottom: 4 }}>{t('nodes.leaf.prohibitedTitle')}</div>
          <div style={{ fontSize: 12, lineHeight: 1.35 }}>
            {t('nodes.leaf.prohibitedText')}
          </div>
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'baseline' }}>
        <div style={{ fontWeight: 'bold', fontSize: 15 }}>{label}</div>
        <span className="rf-badge">{cluster}</span>
      </div>

      <ReferenceInline reference={reference} referenceUrl={referenceUrl} t={t} />

      {checkpointText && (
        <div style={{ marginTop: 2, marginBottom: 10 }}>
          <div style={{ fontSize: 12, lineHeight: 1.35, color: '#111827' }}>{checkpointText}</div>
        </div>
      )}

      {packs.length > 0 && (
        <>
          <div style={{ marginTop: 6, fontSize: 11, fontWeight: 'bold' }}>{t('nodes.leaf.obligationPackages')}</div>
          <div style={{ marginTop: 6, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {packs.map((p) => (
              <span key={p.key} className="rf-tt" style={{ marginRight: 4 }}>
                <span className="rf-badge">{p.label}</span>
                <div className="rf-tt-panel">
                  <div style={{ fontWeight: 700, marginBottom: 6 }}>{t('nodes.leaf.articleReferences')}</div>
                  <ul style={{ margin: 0, paddingLeft: 18 }} className="rf-meta">
                    {p.articles.length ? (
                      p.articles.map((a, idx) => (
                        <li key={`${a}-${idx}`}>{a}</li>
                      ))
                    ) : (
                      <li>–</li>
                    )}
                  </ul>
                </div>
              </span>
            ))}
          </div>
        </>
      )}

      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 14 }}>
        {packs.length > 0 && (
          <button
            className="rf-btn rf-btn--secondary"
            onClick={onStartCheck}
            disabled={checkStarted}
            style={{
              padding: '6px 12px',
              borderRadius: 6,
              border: '1px solid #94a3b8',
              background: checkStarted ? '#eef2f7' : '#f8fafc',
              color: '#111827',
              fontSize: 12,
              cursor: checkStarted ? 'not-allowed' : 'pointer',
            }}
          >
            {t('nodes.leaf.startRequirements')}
          </button>
        )}

        {nextId && packs.length === 0 && (      
          <button
            className="rf-btn rf-btn--primary"
            onClick={onContinue}
            disabled={continueDisabled}
            style={{
              padding: '6px 12px',
              borderRadius: 6,
              border: '1px solid #06b6d4',
              background: continueDisabled ? '#eefbfd' : '#ecfeff',
              color: '#111827',
              fontSize: 12,
              cursor: continueDisabled ? 'not-allowed' : 'pointer',
            }}
          >
            {btnNextLabel}
          </button>
        )}
      </div>
    </div>
  );
}

function ReqQuestionNode({ data }) {
  const { question, onYes, onNo, disabled, answer, step, cluster, info, examples, reference, referenceUrl, t } = data;

  const [showHints, setShowHints] = useState(() => getStoredBool(HINTS_STORAGE_KEY, true));

  const border =
    answer === 'yes'
      ? '2px solid #16a34a'
      : answer === 'no'
        ? '2px solid #dc2626'
        : '1px solid #888';

  const bg =
    answer === 'yes'
      ? '#ecfdf5'
      : answer === 'no'
        ? '#fef2f2'
        : cluster === CLUSTER_DORA
          ? '#eff6ff'
          : '#ffffff';

  const hasHints =
    (typeof info === 'string' && info.trim().length > 0) ||
    (Array.isArray(examples) && examples.length > 0);

  const rootClass = [
    'rf-node',
    'rf-node--req-question',
    cluster === CLUSTER_DORA ? 'is-dora' : 'is-ai',
    answer === 'yes' ? 'is-yes' : '',
    answer === 'no' ? 'is-no' : '',
    disabled ? 'is-disabled' : '',
  ].filter(Boolean).join(' ');

  return (
    <div
      className={rootClass}
      style={{
        position: 'relative',
        padding: '16px 20px',
        borderRadius: 10,
        border,
        background: bg,
        minWidth: 420,
        maxWidth: 640,
        boxShadow: '0 2px 10px rgba(0,0,0,0.12)',
        opacity: disabled ? 0.85 : 1,
      }}
    >
      <div className="step-badge">{step}</div>

      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'baseline' }}>
        <div style={{ fontWeight: 'bold', marginBottom: 4, fontSize: 15 }}>{question}</div>
        <span className="rf-badge">{cluster}</span>
      </div>

      <ReferenceInline reference={reference} referenceUrl={referenceUrl} t={t} />

      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 8 }}>
        <button
          className="rf-btn rf-btn--no"
          onClick={onNo}
          disabled={disabled}
          style={{
            padding: '6px 12px',
            borderRadius: 6,
            border: '1px solid #999',
            background: disabled ? '#f1f5f9' : '#f5f5f5',
            color: '#111827',
            cursor: disabled ? 'not-allowed' : 'pointer',
            fontSize: 12,
          }}
        >
          {t('common.no')}
        </button>
        <button
          className="rf-btn rf-btn--yes"
          onClick={onYes}
          disabled={disabled}
          style={{
            padding: '6px 12px',
            borderRadius: 6,
            border: '1px solid #16a34a',
            background: disabled ? '#e5f9ec' : '#e6fff0',
            color: '#111827',
            cursor: disabled ? 'not-allowed' : 'pointer',
            fontSize: 12,
          }}
        >
          {t('common.yes')}
        </button>
      </div>

      {hasHints && (
        <div style={{ marginTop: 10 }}>
          <button
            className="rf-btn rf-btn--hints"
            type="button"
            onClick={() => setShowHints((v) => !v)}
            style={{
              padding: '4px 10px',
              borderRadius: 6,
              border: '1px solid #cbd5e1',
              background: '#f8fafc',
              color: '#111827',
              fontSize: 11,
              cursor: 'pointer',
            }}
          >
            {showHints ? t('nodes.hideHints') : t('nodes.showHints')}
          </button>

          {showHints && (
            <div
              className="rf-hints-panel"
              style={{
                marginTop: 8,
                padding: 10,
                borderRadius: 8,
                border: '1px dashed #cbd5e1',
                background: '#f9fafb',
                fontSize: 12,
              }}
            >
              {info && info.trim().length > 0 && (
                <p style={{ marginTop: 0, marginBottom: examples?.length ? 8 : 0 }}>{info}</p>
              )}
              {Array.isArray(examples) && examples.length > 0 && (
                <>
                  <div style={{ fontWeight: 600, marginBottom: 4 }}>{t('common.examples')}</div>
                  <ul style={{ margin: 0, paddingLeft: 18 }}>
                    {examples.map((ex, idx) => (
                      <li key={idx}>{ex}</li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function normalizeArticleLabel(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[–—]/g, '-') 
    .replace(/\s+/g, ' ');
}

function extractFirstArticleNumber(label) {
  const s = String(label ?? '');
  const m = s.match(/Art\.\s*(\d+)/i) || s.match(/Artikel\s*(\d+)/i);
  return m ? Number.parseInt(m[1], 10) : Number.POSITIVE_INFINITY;
}

function extractArticleNumberFromUrl(url) {
  const s = String(url ?? '');
  const m =
    s.match(/artikel-(\d+)-/i) ||
    s.match(/artikel-(\d+)\b/i) ||
    s.match(/art(?:ikel)?[/_-](\d+)\b/i);
  return m ? Number.parseInt(m[1], 10) : Number.POSITIVE_INFINITY;
}

function pickBetterUrl({ currentUrl, candidateUrl, articleLabel }) {
  if (!candidateUrl) return currentUrl ?? null;
  if (!currentUrl) return candidateUrl;

  const a = extractArticleNumberFromUrl(currentUrl);
  const b = extractArticleNumberFromUrl(candidateUrl);

  if (Number.isFinite(a) && Number.isFinite(b) && a !== b) {
    return a < b ? currentUrl : candidateUrl;
  }

  const first = extractFirstArticleNumber(articleLabel);
  if (Number.isFinite(first)) {
    if (a === first) return currentUrl;
    if (b === first) return candidateUrl;
  }

  return currentUrl;
}

function groupMissingByRegulationAndFirstArticleOnce(missing = [], t) {
  const byReg = new Map(); 
  const seen = new Set(); 

  for (const m of missing) {
    if (!m) continue;

    const dedupKey = m.canonicalId ?? m.id ?? `${m.todo ?? ''}__${m.pkgKey ?? ''}`;
    if (seen.has(dedupKey)) continue;
    seen.add(dedupKey);

    const regulation = m.regulation ?? t?.('nodes.summary.unknownRegulation') ?? 'Unbekannte Verordnung';
    const articleLabel =
      (m.reference && String(m.reference).trim()) ||
      ((Array.isArray(m.articles) && m.articles.length ? m.articles[0] : '') || '').trim() ||
      (t?.('nodes.summary.noArticleReference') ?? 'Ohne Artikel/Referenz');

    const articleUrl = m.referenceUrl ?? null;

    const articleKey = normalizeArticleLabel(articleLabel);

    if (!byReg.has(regulation)) byReg.set(regulation, new Map());
    const byArticle = byReg.get(regulation);

    if (!byArticle.has(articleKey)) {
      byArticle.set(articleKey, {
        key: articleKey,
        article: articleLabel,
        url: articleUrl,
        sortKey: extractFirstArticleNumber(articleLabel),
        items: [],
      });
    } else {
      const existing = byArticle.get(articleKey);
      existing.url = pickBetterUrl({
        currentUrl: existing.url,
        candidateUrl: articleUrl,
        articleLabel: existing.article,
      });
      existing.sortKey = Math.min(existing.sortKey, extractFirstArticleNumber(articleLabel));
    }

    byArticle.get(articleKey).items.push(m);
  }

  const regulationRank = (reg) => {
    const s = String(reg ?? '').toLowerCase();
    if (s.includes('ai act')) return 0; 
    if (s.includes('dora')) return 1;
    return 2;
  };

  return Array.from(byReg.entries())
    .sort(([a], [b]) => {
      const ra = regulationRank(a);
      const rb = regulationRank(b);
      if (ra !== rb) return ra - rb;
      return String(a).localeCompare(String(b), 'de');
    })
    .map(([regulation, byArticle]) => ({
      regulation,
      articles: Array.from(byArticle.values())
        .sort((a, b) => {
          if (a.sortKey !== b.sortKey) return a.sortKey - b.sortKey;
          return String(a.article).localeCompare(String(b.article));
        })
        .map((a) => ({ key: a.key, article: a.article, url: a.url, items: a.items })),
    }));
}

function ReqSummaryNode({ data }) {
  const { missing = [], onContinue, continueDisabled, nextId, step, cluster, t } = data;
  const hasMissing = missing.length > 0;

  const grouped = useMemo(
    () => groupMissingByRegulationAndFirstArticleOnce(missing, t),
    [missing, t]
  );

  const rootClass = [
    'rf-node',
    'rf-node--summary',
    cluster === CLUSTER_DORA ? 'is-dora' : 'is-ai',
    hasMissing ? 'is-missing' : 'is-ok',
  ].join(' ');

  return (
    <div
      className={rootClass}
      style={{
        position: 'relative',
        padding: '16px 20px',
        borderRadius: 10,
        border: `1px solid ${hasMissing ? '#fecdd3' : '#a7f3d0'}`,
        background: hasMissing ? '#fff1f2' : (cluster === CLUSTER_DORA ? '#eff6ff' : '#ecfdf5'),
        minWidth: 420,
        maxWidth: 640,
        boxShadow: '0 2px 10px rgba(0,0,0,0.12)',
      }}
    >
      <div className="step-badge">{step}</div>

      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'baseline' }}>
        <div style={{ fontWeight: 'bold', marginBottom: 8, fontSize: 15 }}>
          {hasMissing ? t('nodes.summary.missing') : t('nodes.summary.complete')}
        </div>
        <span className="rf-badge">{cluster}</span>
      </div>

      {hasMissing ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {grouped.map((reg) => (
            <div key={reg.regulation}>
              <div style={{ fontWeight: 800, fontSize: 13, marginBottom: 6 }}>
                {reg.regulation}
              </div>

              {reg.articles.map((a) => (
                <div key={`${reg.regulation}__${a.key}`} style={{ marginTop: 8 }}>
                  <div style={{ fontWeight: 700, fontSize: 12, marginBottom: 4 }}>
                    <ArticleLink label={a.article} url={a.url} />
                  </div>

                  <ul style={{ margin: 0, paddingLeft: 18 }}>
                    {a.items.map((m) => (
                      <li key={`${m.pkgKey}__${m.id}__${a.article}`}>
                        {m.todo}{' '}
                        <span className="rf-meta">
                          ({m.pkgLabel})
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          ))}
        </div>
      ) : (
        <div className="rf-meta">{t('nodes.summary.canContinue')}</div>
      )}

      {nextId && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}>
          <button
            className="rf-btn rf-btn--primary"
            onClick={onContinue}
            disabled={continueDisabled}
            style={{
              padding: '6px 12px',
              borderRadius: 6,
              border: '1px solid #06b6d4',
              background: continueDisabled ? '#eefbfd' : '#ecfeff',
              color: '#111827',
              cursor: continueDisabled ? 'not-allowed' : 'pointer',
              fontSize: 12,
            }}
          >
            {nextId === 'D0' ? t('nodes.leaf.goToDora') : nextId === 'ENDE' ? t('nodes.leaf.finish') : t('common.continue')}
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * Domänenspezifische Konsistenzprüfung über den gesamten bisherigen Pfad
 * Ziel: Der Nutzer soll keine widersprüchlichen Klassifikationen "durchklicken" können
 *
 * Ergebnis: Liste von Violations (Code, Message, Konfliktstellen, Empfehlungen)
 * Diese wird im Wizard als Blocker angezeigt (Review-Hilfe / Rücksprung)
 */
function validatePathConsistency({ answers, pathIds, activePath, decisionTree, t }) {
  const violations = [];

  const cleanPathIds = (Array.isArray(pathIds)
    ? pathIds.filter(Boolean)
    : (activePath || []).map((n) => n.id).filter(Boolean)
  ).filter((id) => !String(id).includes('__req__'));

  const leafIdsInPath = cleanPathIds.filter((id) => decisionTree[id]?.type === 'leaf');

  const nodeLabel = (id) => decisionTree[id]?.label || id;
  const answerLabel = (a) => (a === 'yes' ? t('common.yes') : a === 'no' ? t('common.no') : a ?? '-');

  const hasObligation = (nodeId, obligationKey) =>
    (decisionTree[nodeId]?.obligations || []).includes(obligationKey);

  const hrLeafIds = leafIdsInPath.filter((id) =>
    (decisionTree[id]?.obligations || []).some(
      (o) => o === 'KI_HR_ANBIETER' || o === 'KI_HR_BETREIBER' || o === 'KI_HR_BETREIBER_FIN'
    )
  );

  const prohibitedLeafIds = leafIdsInPath.filter((id) => hasObligation(id, 'KI_VERBOTENE_PRAKTIKEN'));

  const conflictEntry = (nodeId, extra = {}) => ({
    nodeId,
    label: nodeLabel(nodeId),
    answer: answerLabel(answers?.[nodeId]),
    ...extra,
  });

  const addViolation = (v) => violations.push(v);

  if (answers?.A1 === 'no') {
    const laterAnswered = Object.keys(answers || {})
      .filter((id) => id !== 'A1')
      .filter((id) => answers[id] === 'yes' || answers[id] === 'no')
      .filter((id) => id.startsWith('A') || id.startsWith('W_') || id.startsWith('G_'));

    if (laterAnswered.length > 0) {
      addViolation({
        code: 'A1_NO_BUT_LATER_ANSWERED',
        message: t('consistency.a1NoButLaterAnswered.message'),
        conflicts: [
          conflictEntry('A1', { note: t('consistency.a1NoButLaterAnswered.noteA1') }),
          ...laterAnswered.slice(0, 4).map((id) => conflictEntry(id, { note: t('consistency.a1NoButLaterAnswered.noteLater') })),
        ],
        suggestedNodeId: 'W_KI_WIDERSPRUCH',
        primaryActionNodeId: 'A1',
        recommendations: [
          t('consistency.a1NoButLaterAnswered.recommendation1'),
          t('consistency.a1NoButLaterAnswered.recommendation2'),
        ],
      });
    }
  }

  const highRiskLocked = hrLeafIds.length > 0;

  if (highRiskLocked) {
    const downstageCandidates = ['A3_ANBIETER', 'A3_BETREIBER'];
    const attemptedDownstage = downstageCandidates.filter((id) => answers?.[id] === 'no');

    if (attemptedDownstage.length > 0) {
      addViolation({
        code: 'HOCHRISIKO_HERUNTERSTUFUNG',
        message: t('consistency.highRiskDownstage.message'),
        conflicts: [
          ...hrLeafIds.slice(0, 2).map((id) =>
            conflictEntry(id, { note: t('consistency.highRiskDownstage.noteHighRisk') })
          ),
          ...attemptedDownstage.map((id) => conflictEntry(id, { note: t('consistency.highRiskDownstage.noteDownstage') })),
        ],
        suggestedNodeId: 'W_KI_WIDERSPRUCH',
        primaryActionNodeId: attemptedDownstage[0] || hrLeafIds[0],
        recommendations: [
          t('consistency.highRiskDownstage.recommendation1'),
          t('consistency.highRiskDownstage.recommendation2'),
        ],
      });
    }
  }

  const NON_HR_PATH_IDS = new Set([
    'A3_NICHT_HOCHRISIKO_PRUEFUNG',
    'A4_TRANSPARENZ_ANWENDBAR',
    'A4_NICHT_HOCHRISIKO_MIT_TRANSPARENZ',
    'A4_NICHT_HOCHRISIKO_NUR_MINIMAL',
    'G_AI_NICHT_HOCHRISIKO_PLAUSIBILITAET',
  ]);

  if (highRiskLocked) {
    const firstNonHr = cleanPathIds.find((id) => NON_HR_PATH_IDS.has(id));
    if (firstNonHr) {
      addViolation({
        code: 'HOCHRISIKO_PFAD_WIDERSPRUCH',
        message: t('consistency.highRiskConflict.message'),
        conflicts: [
          ...hrLeafIds.slice(0, 2).map((id) =>
            conflictEntry(id, { note: t('consistency.highRiskConflict.noteHighRisk') })
          ),
          conflictEntry(firstNonHr, { note: t('consistency.highRiskConflict.noteNonHighRisk') }),
        ],
        suggestedNodeId: 'W_KI_WIDERSPRUCH',
        primaryActionNodeId: firstNonHr,
        recommendations: [
          t('consistency.highRiskConflict.recommendation1'),
          t('consistency.highRiskConflict.recommendation2'),
        ],
      });
    }
  }

  const prohibitedLocked = prohibitedLeafIds.length > 0;

  if (prohibitedLocked) {
    const prohibitedLeafId = prohibitedLeafIds[0];
    const idxProhibited = cleanPathIds.indexOf(prohibitedLeafId);
    const laterNodes = cleanPathIds.slice(Math.max(0, idxProhibited + 1));

    const answeredLaterAfterProhibited = laterNodes.filter(
      (id) => answers?.[id] === 'yes' || answers?.[id] === 'no'
    );

    if (answeredLaterAfterProhibited.length > 0) {
      addViolation({
        code: 'PROHIBITED_CONTINUED',
        message: t('consistency.prohibitedContinued.message'),
        conflicts: [
          conflictEntry(prohibitedLeafId, { note: t('consistency.prohibitedContinued.noteProhibited') }),
          ...answeredLaterAfterProhibited.slice(0, 3).map((id) =>
            conflictEntry(id, { note: t('consistency.prohibitedContinued.noteAfter') })
          ),
        ],
        suggestedNodeId: 'W_KI_WIDERSPRUCH',
        primaryActionNodeId: prohibitedLeafId,
        recommendations: [
          t('consistency.prohibitedContinued.recommendation1'),
          t('consistency.prohibitedContinued.recommendation2'),
        ],
      });
    }
  }

  if (answers?.D0 === 'no') {
    const doraQuestionAnswered = Object.keys(answers).some((id) => {
      if (!/^B\d+/.test(id)) return false;
      return answers[id] != null;
    });

    if (doraQuestionAnswered) {
      addViolation({
        code: 'DORA_ABGELEHNT_ABER_FORTGESETZT',
        message: t('consistency.doraRejectedButContinued.message'),
        conflicts: [
          conflictEntry('D0', { note: t('consistency.doraRejectedButContinued.noteStart') }),
          ...Object.keys(answers)
            .filter((id) => /^B\d+/.test(id) && answers[id] != null)
            .slice(0, 4)
            .map((id) => conflictEntry(id, { note: t('consistency.doraRejectedButContinued.noteQuestion') })),
        ],
        suggestedNodeId: 'D0',
        primaryActionNodeId: 'D0',
        recommendations: [
          t('consistency.doraRejectedButContinued.recommendation1'),
          t('consistency.doraRejectedButContinued.recommendation2'),
        ],
      });
    }
  }

  return { violations };
}

/**

 * Navigation, Zustandsführung, Ableitung regulatorischer Pflichten und Erzeugung der Exportdaten.
 *
 * - path: sequenzielle Liste der besuchten Step-IDs
 * - answers: Map für Decision-Nodes und Requirements
 * - currentStepIndex / activePathLength: Timeline-Navigation (Zurückspringen ohne sofortiges Löschen)
 * - reqAnswerByCanonicalId: Deduplizierte Sicht auf Requirement-Antworten (canonicalId als Schlüssel),
 *   um identische Anforderungen aus mehreren Pflichtenpaketen nicht mehrfach prüfen zu müssen
 *
 * Navigationsprinzip:
 * - Decision-Nodes wählen über yes/no den nächsten Node und laufen ggf. durch validateNextNode()
 * - Leaf-Nodes können den Requirement-Check starten oder "weiter" gehen
 * - Requirement-Nodes werden sequenziell abgearbeitet; bereits beantwortete canonicalIds werden übersprungen;
 *   am Ende steht ein __req__summary-Step, der offene Requirements aggregiert und die Fortsetzung erlaubt
 */
function Wizard({
  createdBy,
  assessmentTitle,
  locale,
  onLocaleChange,
  onAssessmentLoaded,
  initialAssessment,
  t,
}) {
  const model = useMemo(() => getLocalizedModel(locale), [locale]);
  const { decisionTree, obligationsCatalog } = model;

  const [assessmentId, setAssessmentId] = useState(() => createAssessmentId());
  const [createdAt, setCreatedAt] = useState(() => new Date());
  const [path, setPath] = useState([{ id: 'A1' }]);
  const [answers, setAnswers] = useState({});

  const [isExporting, setIsExporting] = useState(false);
  const [saveMessage, setSaveMessage] = useState('');
  const [savedAssessments, setSavedAssessments] = useState(() => listSavedAssessments());
  const [isManagerOpen, setIsManagerOpen] = useState(false);
  const [openHeaderMenu, setOpenHeaderMenu] = useState(null);
  const [importWarning, setImportWarning] = useState('');
  const fileInputRef = useRef(null);
  const appliedInitialAssessmentIdRef = useRef(null);

  const exportIncludePkgs = true;

  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [activePathLength, setActivePathLength] = useState(1);

  const [updatedAt, setUpdatedAt] = useState(() => new Date());
  const [assessmentVersion, setAssessmentVersion] = useState('v1.0');

  const updatedAtLabel = useMemo(
      () => updatedAt.toLocaleString(locale === 'en' ? 'en-US' : 'de-DE'),
      [locale, updatedAt]
    );
  
  const [consistencyViolations, setConsistencyViolations] = useState([]);
  const [conflictHelpOpen, setConflictHelpOpen] = useState(false);

  const refreshSavedAssessments = useCallback(() => {
    setSavedAssessments(listSavedAssessments());
  }, []);

  const applyAssessment = useCallback((rawAssessment, { notifyParent = false } = {}) => {
    const assessment = normalizeAssessment(rawAssessment);
    const missingIds = getMissingModelIds(assessment, decisionTree);

    setAssessmentId(assessment.assessmentId);
    setCreatedAt(new Date(assessment.createdAt));
    setPath(assessment.path.length ? assessment.path : [{ id: 'A1' }]);
    setAnswers(assessment.answers);
    setCurrentStepIndex(
      Math.min(assessment.currentStepIndex, Math.max(0, assessment.path.length - 1))
    );
    setActivePathLength(
      Math.min(
        Math.max(assessment.activePathLength, 1),
        Math.max(assessment.path.length, 1)
      )
    );
    setUpdatedAt(new Date(assessment.updatedAt));
    setAssessmentVersion(assessment.revision || 'v1.0');
    window.localStorage.setItem('assessmentVersion', assessment.revision || 'v1.0');
    setConsistencyViolations([]);
    setConflictHelpOpen(false);
    if (notifyParent) onAssessmentLoaded?.(assessment);

    setImportWarning(
      missingIds.length
        ? t('persistence.missingIdsWarning', { ids: missingIds.join(', ') })
        : ''
    );
  }, [decisionTree, onAssessmentLoaded, t]);

  useEffect(() => {
    if (!initialAssessment) return;
    if (appliedInitialAssessmentIdRef.current === initialAssessment.assessmentId) return;
    appliedInitialAssessmentIdRef.current = initialAssessment.assessmentId;
    applyAssessment(initialAssessment);
  }, [initialAssessment, applyAssessment]);

  const getAnswerText = useCallback((nodeId, value) => {
    if (!value) return '';
  
    if (nodeId.includes('__req__')) {
      return value === 'yes' ? t('common.yes') : t('common.no');
    }
  
    const def = decisionTree[nodeId];
    const YES = def?.yesLabel ?? t('common.yes');
    const NO = def?.noLabel ?? t('common.no');
    return value === 'yes' ? YES : NO;
  }, [decisionTree, t]);  


  useEffect(() => {
    const stored = window.localStorage.getItem('assessmentVersion');
    if (stored) setAssessmentVersion(stored);
  }, []);

  const resetAssessmentVersion = useCallback(() => {
    setAssessmentVersion('v1.0');
    window.localStorage.setItem('assessmentVersion', 'v1.0');
  }, []);

  const currentId = path[currentStepIndex]?.id ?? 'A1';

// Deduplizierung von Requirement-Antworten:
// Mehrere Leaves können identische Requirements auslösen, canonicalId bildet diese zusammen
// Konfliktfall (unterschiedliche Antworten für gleiche canonicalId) wird konservativ als "no" behandelt
  const reqAnswerByCanonicalId = useMemo(() => {
    const m = new Map();

    for (const [id, a] of Object.entries(answers)) {
      if (!id.includes('__req__') || id.includes('__req__summary')) continue;
      if (a !== 'yes' && a !== 'no') continue;

      const canonicalId = getCanonicalIdForRequirementInstance(id, model) ?? id.split('__req__')[1];
      const prev = m.get(canonicalId);

      if (!prev) m.set(canonicalId, a);
      else if (prev !== a) m.set(canonicalId, 'no'); 
    }

    return m;
  }, [answers, model]);

  // Descriptor beschreibt den aktuell zu rendernden Schritt
  // und kapselt die aus dem Modell abgeleiteten UI-Daten
  const descriptor = useMemo(() => {
    if (currentId.includes('__req__summary')) {
      const leafId = currentId.split('__req__')[0];
      const { reqs } = getRequirementChain(leafId, model);
      return {
        kind: 'summary',
        id: currentId,
        leafId,
        missing: reqs.filter((r) => reqAnswerByCanonicalId.get(r.canonicalId) !== 'yes'),
        nextId: decisionTree[leafId]?.next,
        cluster: getClusterForNodeId(leafId, decisionTree, obligationsCatalog),
      };
    }

    if (currentId.includes('__req__')) {
      const [leafId] = currentId.split('__req__');
      const { reqs } = getRequirementChain(leafId, model);
      const req = reqs.find(r => r.id === currentId);
      if (!req) return { kind: 'unknown', id: currentId };

      return {
        kind: 'req',
        id: currentId,
        leafId,
        question: req.question,
        pkgLabel: req.pkgLabel,
        articles: req.articles ?? [],
        cluster: getClusterForNodeId(leafId, decisionTree, obligationsCatalog),
        info: req.info,
        examples: req.examples,
        reference: req.reference,
        referenceUrl: req.referenceUrl,
      };
    }

    const def = decisionTree[currentId];
    if (!def) return { kind: 'unknown', id: currentId };

    if (def.type === 'question') {
      return {
        kind: 'question',
        id: currentId,
        label: def.label,
        cluster: getClusterForNodeId(currentId, decisionTree, obligationsCatalog),
        yesLabel: def.yesLabel,
        noLabel: def.noLabel,
        info: def.info,
        examples: def.examples,
        checkpointText: def.checkpointText,
        reference: def.reference,
        referenceUrl: def.referenceUrl,
      };
    }

    return {
      kind: 'leaf',
      id: currentId,
      label: def.label,
      obligationKeys: def.obligations ?? [],
      nextId: def.next,
      cluster: getClusterForNodeId(currentId, decisionTree, obligationsCatalog),
      checkpointText: def.checkpointText,
      reference: def.reference,
      referenceUrl: def.referenceUrl,
    };
  }, [currentId, decisionTree, obligationsCatalog, model, reqAnswerByCanonicalId]);


  // Historiennavigation: Zurückspringen ist erlaubt, aber mit aktiver "Prefix"-Logik
  // Bei Sprüngen wird eine evtl. angezeigte Konsistenzverletzung zurückgesetzt
  const jumpToStep = useCallback((index) => {
    setConsistencyViolations([]);
    setCurrentStepIndex(index);
  }, []);

  const jumpToNodeId = useCallback(
    (nodeId) => {
      const idx = path.findIndex((n) => n.id === nodeId);
      if (idx >= 0) jumpToStep(idx);
    },
    [path, jumpToStep]
  );

  function pruneAnswersAfterBranchChange({ nextAnswers, keepIds, clearRequirements }) {
    const pruned = { ...nextAnswers };
  
    for (const key of Object.keys(pruned)) {
      if (clearRequirements && key.includes('__req__')) {
        delete pruned[key];
        continue;
      }
      if (!keepIds.has(key)) delete pruned[key];
    }
  
    return pruned;
  }

/**
 * Persistiert eine Antwort  und berechnet den nächsten Schritt
 *
 * Zwei Pfade:
 * 1) Requirement-Instanzen (__req__...): lineare Abarbeitung der Requirement-Chain; bereits erfüllte canonicalIds werden übersprungen
 * 2) Decision-Tree-Nodes: Next-ID ergibt sich aus yes/no; validateNextNode() kann den Fluss in Review-/Gate-Knoten umleiten
 *
 * In beiden Fällen wird vor dem Fortschreiben des Pfads validatePathConsistency() ausgeführt,
 * um widersprüchliche Klassifikationen zu blockieren.
 */
  const answerNode = useCallback(
    (id, answer) => {
      const basePath = path.slice(0, currentStepIndex + 1);
      const baseIds = basePath.map((s) => s.id);
      const keepIds = new Set(baseIds);

      const isRequirement = id.includes('__req__');
      const prevAnswer = answers[id];

      if (isRequirement) {
        let { nextReqId, summaryId } = getNextInRequirementChain(id, model);
        let nextId = nextReqId ?? summaryId;
        if (!nextId) return;

        const nextAnswersRaw = { ...answers, [id]: answer };

        const answeredCanonicalIds = new Set(reqAnswerByCanonicalId.keys());
        const currentCanonical = getCanonicalIdForRequirementInstance(id, model);
        if (currentCanonical) answeredCanonicalIds.add(currentCanonical);

        while (nextId && nextId.includes('__req__') && !nextId.includes('__req__summary')) {
          const a = nextAnswersRaw[nextId];

          const canonicalId = getCanonicalIdForRequirementInstance(nextId, model);
          const alreadyAnswered =
            (a === 'yes' || a === 'no') || (canonicalId && answeredCanonicalIds.has(canonicalId));

          if (!alreadyAnswered) break;

          const step = getNextInRequirementChain(nextId, model);
          summaryId = step.summaryId;
          nextId = step.nextReqId ?? summaryId;
        }

        const existingNext = path[currentStepIndex + 1]?.id;

        if (prevAnswer === answer && existingNext === nextId) {
          setConsistencyViolations([]);
          setCurrentStepIndex(currentStepIndex + 1);
          setUpdatedAt(new Date());
          return;
        }

        const nextPathIds = [...baseIds, nextId];

        const { violations } = validatePathConsistency({
          decisionTree,
          obligationsCatalog,
          answers: nextAnswersRaw,
          pathIds: nextPathIds,
          t,
        });

        if (violations?.length) {
          setConsistencyViolations(violations);
          return;
        }

        setConsistencyViolations([]);
        setAnswers(nextAnswersRaw);
        setPath([...basePath, { id: nextId }]);
        setCurrentStepIndex(basePath.length);
        setActivePathLength(basePath.length + 1);
        setUpdatedAt(new Date());
        return;
      }

      const def = decisionTree[id];
      const rawNextId = answer === 'yes' ? def?.yes : def?.no;
      if (!rawNextId) return;

      let nextAnswersRaw = { ...answers, [id]: answer };

      const { nextId } = validateNextNode({
        currentId: id,
        answer,
        nextId: rawNextId,
        answers: nextAnswersRaw,
        pathIds: [...baseIds, rawNextId],
        model,
      });

      const existingNext = path[currentStepIndex + 1]?.id;

      if (prevAnswer === answer && existingNext === nextId) {
        setConsistencyViolations([]);
        setCurrentStepIndex(currentStepIndex + 1);
        setUpdatedAt(new Date());
        return;
      }

      const isChangingDecision = prevAnswer != null && prevAnswer !== answer;
      const isPathMismatchWithoutChange = prevAnswer === answer && existingNext && existingNext !== nextId;

      if (isChangingDecision || isPathMismatchWithoutChange) {
        nextAnswersRaw = pruneAnswersAfterBranchChange({
          nextAnswers: nextAnswersRaw,
          keepIds,
          clearRequirements: true,
        });
      }

      const nextPathIds = [...baseIds, nextId];

      const { violations } = validatePathConsistency({
        decisionTree,
        obligationsCatalog,
        answers: nextAnswersRaw,
        pathIds: nextPathIds,
        t,
      });

      if (violations?.length) {
        setConsistencyViolations(violations);
        return;
      }

      setConsistencyViolations([]);
      setAnswers(nextAnswersRaw);
      setPath([...basePath, { id: nextId }]);
      setCurrentStepIndex(basePath.length);
      setActivePathLength(basePath.length + 1);
      setUpdatedAt(new Date());
    },
    [
      answers,
      path,
      currentStepIndex,
      decisionTree,
      obligationsCatalog,
      reqAnswerByCanonicalId,
      model,
      t,
    ]
  );

  // Navigation aus Leaf-Knoten:
  // - continueFromLeaf: setzt den Fluss im decisionTree über def.next fort (inkl. validateNextNode + Konsistenzcheck)
  // - startCheck: wechselt vom Leaf in die Requirement-Chain des/der ausgelösten Pflichtenpakete
  const continueFromLeaf = useCallback(
    (leafId) => {
      let nextId = decisionTree[leafId]?.next;
      if (!nextId) return;
  
      const basePath = path.slice(0, currentStepIndex + 1);
      const baseIds = basePath.map((s) => s.id);
  
      nextId = validateNextNode({
        currentId: leafId,
        answer: undefined,
        nextId,
        answers,
        pathIds: [...baseIds, nextId],
        model,
      }).nextId;
  
      const nextPathIds = [...baseIds, nextId];
      const { violations } = validatePathConsistency({
        decisionTree,
        obligationsCatalog,
        answers,
        pathIds: nextPathIds,
        t,
      });
  
      if (violations?.length) {
        setConsistencyViolations(violations);
        return;
      }
  
      setConsistencyViolations([]);
      setPath([...basePath, { id: nextId }]);
      setCurrentStepIndex(basePath.length);
      setActivePathLength(basePath.length + 1);
      setUpdatedAt(new Date());
    },
    [answers, path, currentStepIndex, decisionTree, obligationsCatalog, model, t]
  );

  const startCheck = useCallback(
    (leafId) => {
      const { reqs, summaryId } = getRequirementChain(leafId, model);
      if (!reqs?.length) return;
  
      const answeredCanonicalIds = new Set(reqAnswerByCanonicalId.keys());
  
      const firstOpen = reqs.find((r) => {
        const instId = r.id ?? r.instanceId;
        if (!instId) return false;
  
        const cId =
          r.canonicalId ??
          getCanonicalIdForRequirementInstance(instId, model) ??
          instId.split('__req__')[1];
  
        return !answeredCanonicalIds.has(cId);
      });
  
      const nextId =
        (firstOpen?.id ?? firstOpen?.instanceId) ??
        summaryId ??
        (reqs[0].id ?? reqs[0].instanceId);
  
      if (!nextId) return;
  
      const basePath = path.slice(0, currentStepIndex + 1);
      const baseIds = basePath.map((s) => s.id);
  
      const { violations } = validatePathConsistency({
        decisionTree,
        obligationsCatalog,
        answers,
        pathIds: [...baseIds, nextId],
        t,
      });
  
      if (violations?.length) {
        setConsistencyViolations(violations);
        return;
      }
  
      setConsistencyViolations([]);
      setPath([...basePath, { id: nextId }]);
      setCurrentStepIndex(basePath.length);
      setActivePathLength(basePath.length + 1);
      setUpdatedAt(new Date());
    },
    [
      path,
      currentStepIndex,
      answers,
      reqAnswerByCanonicalId,
      decisionTree,
      obligationsCatalog,
      setConsistencyViolations,
      model,
      t,
    ]
  );

  // Globaler Reset des Assessments: Pfad und Antworten werden auf den Startzustand zurückgesetzt
  const handleReset = useCallback(() => {
    setPath([{ id: 'A1' }]);
    setAnswers({});
    setCurrentStepIndex(0);
    setActivePathLength(1);
    setUpdatedAt(new Date());
  }, []);

  const buildCurrentAssessment = useCallback((overrides = {}) => {
    const now = new Date();

    return normalizeAssessment({
      assessmentId,
      title: assessmentTitle || t('persistence.untitled'),
      createdBy,
      createdAt: createdAt.toISOString(),
      updatedAt: now.toISOString(),
      locale,
      revision: assessmentVersion,
      modelVersion: MODEL_VERSION,
      appVersion: APP_VERSION,
      path: path.slice(0, activePathLength),
      answers,
      currentStepIndex,
      activePathLength,
      ...overrides,
    });
  }, [
    activePathLength,
    answers,
    assessmentId,
    assessmentTitle,
    assessmentVersion,
    createdAt,
    createdBy,
    currentStepIndex,
    locale,
    path,
    t,
  ]);

  const handleSaveAssessment = useCallback(() => {
    const saved = saveAssessment(buildCurrentAssessment());
    setAssessmentId(saved.assessmentId);
    setUpdatedAt(new Date(saved.updatedAt));
    refreshSavedAssessments();
    setSaveMessage(t('persistence.savedMessage'));
  }, [buildCurrentAssessment, refreshSavedAssessments, t]);

  const handleExportJson = useCallback(() => {
    const assessment = buildCurrentAssessment();
    downloadJsonFile(buildAssessmentFileName(assessment), assessment);
  }, [buildCurrentAssessment]);

  const handleLoadAssessment = useCallback((assessment) => {
    applyAssessment(assessment, { notifyParent: true });
    setIsManagerOpen(false);
  }, [applyAssessment]);

  const handleDeleteAssessment = useCallback((assessmentIdToDelete) => {
    if (!window.confirm(t('persistence.deleteConfirm'))) return;
    deleteAssessment(assessmentIdToDelete);
    refreshSavedAssessments();
  }, [refreshSavedAssessments, t]);

  const handleImportJsonFile = useCallback(async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      const validation = validateImportedAssessment(parsed);
      if (!validation.ok) {
        setImportWarning(validation.error);
        return;
      }

      const imported = normalizeAssessment({
        ...parsed,
        assessmentId: parsed.assessmentId || createAssessmentId(),
        updatedAt: new Date().toISOString(),
      });

      const saved = saveAssessment(imported);
      refreshSavedAssessments();
      applyAssessment(saved, { notifyParent: true });
      setIsManagerOpen(false);
    } catch (error) {
      setImportWarning(`${t('persistence.importError')} ${error?.message ?? ''}`.trim());
    }
  }, [applyAssessment, refreshSavedAssessments, t]);
  
  const continueFromSummary = useCallback(
    (leafId) => {
      let nextId = decisionTree[leafId]?.next;
      if (!nextId) return;
  
      const basePath = path.slice(0, currentStepIndex + 1);
      const baseIds = basePath.map((s) => s.id);
  
      nextId = validateNextNode({
        currentId: leafId,
        answer: undefined,
        nextId,
        answers,
        pathIds: [...baseIds, nextId],
        model,
      }).nextId;
  
      const nextPathIds = [...baseIds, nextId];
      const { violations } = validatePathConsistency({
        decisionTree,
        obligationsCatalog,
        answers,
        pathIds: nextPathIds,
        t,
      });
  
      if (violations?.length) {
        setConsistencyViolations(violations);
        return;
      }
  
      setConsistencyViolations([]);
      setPath([...basePath, { id: nextId }]);
      setCurrentStepIndex(basePath.length);
      setActivePathLength(basePath.length + 1);
      setUpdatedAt(new Date());
    },
    [answers, path, currentStepIndex, decisionTree, obligationsCatalog, model, t]
  );

  /**
   * Verdichtet den internen Wizard-State zu einem exportierbaren, stabilen Datenmodell:
   * - path: Schrittfolge inkl. Labels und Antworten
   * - missing: pro Leaf die offenen Requirements (abgeleitet aus reqAnswerByCanonicalId)
   * - packagesByLeaf: optionale Auflistung ausgelöster Pflichtenpakete
   */
  const buildExportPayload = useCallback((versionForExport) => {
    const exportPath = path.slice(0, activePathLength);

    const pathPayload = exportPath.map((step) => {
      const id = step.id;
      let label = id;
      let kind = 'unknown';

      if (id.includes('__req__summary')) {
        const leafId = id.split('__req__')[0];
        label = t('wizard.summaryPrefixExport', { label: decisionTree[leafId]?.label ?? leafId });
        kind = 'summary';
      } else if (id.includes('__req__')) {
        const [leafId] = id.split('__req__');
        const { reqs } = getRequirementChain(leafId, model);
        const req = reqs.find((r) => r.id === id);
        label = req?.question ?? id;
        kind = 'requirement';
      } else {
        const def = decisionTree[id];
        label = def?.label ?? id;
        kind = def?.type ?? 'node';
      }
      
      const rawAnswer = answers[id] ?? null;

      return {
        id,
        label,
        kind,
        answerRaw: rawAnswer,
        answer: rawAnswer ? getAnswerText(id, rawAnswer) : null,
      };
    });

    const leavesInPath = new Set(
      exportPath
        .filter((s) => !s.id.includes('__req__'))
        .map((s) => s.id)
        .filter((id) => decisionTree[id]?.type === 'leaf')
    );

    const reqAnswerByCanonicalIdForExport = buildReqAnswerByCanonicalIdForLeaves({
      answers,
      leavesInPath,
      getCanonicalIdForRequirementInstance: (instanceId) => getCanonicalIdForRequirementInstance(instanceId, model),
    });

    const missing = {};
    for (const leafId of leavesInPath) {
      const { reqs } = getRequirementChain(leafId, model);
      if (!reqs.length) continue;
      const missingReqs = reqs.filter(
        (r) => reqAnswerByCanonicalIdForExport.get(r.canonicalId) !== 'yes');
      if (!missingReqs.length) continue;
      missing[leafId] = missingReqs.map((r) => ({
        id: r.id,
        canonicalId: r.canonicalId,
        question: r.question ?? '',
        todo: r.todo ?? '', 
        pkgKey: r.pkgKey,
        pkgLabel: r.pkgLabel,
        regulation: r.regulation,
        articles: r.articles ?? [],
        reference: r.reference ?? null,
        referenceUrl: r.referenceUrl ?? null,
      }));
    }

    const packagesByLeaf = {};
      if (exportIncludePkgs) {
        for (const leafId of leavesInPath) {
          const def = decisionTree[leafId];
          if (!def?.obligations?.length) continue;

          packagesByLeaf[leafId] = def.obligations.map((k) => ({
            key: k,
            label: obligationsCatalog[k]?.label ?? k,
            articles: obligationsCatalog[k]?.articles ?? [],
          }));
        }
      }

    return {
      assessmentId: versionForExport,
      savedAssessmentId: assessmentId,
      title: assessmentTitle,
      createdBy,
      createdAt: createdAt.toISOString(),
      lastUpdated: updatedAt.toISOString(),
      modelVersion: MODEL_VERSION,
      appVersion: APP_VERSION,
      path: pathPayload,
      missing,
      packagesByLeaf: exportIncludePkgs ? packagesByLeaf : null,
    };
  }, [
    answers,
    activePathLength,
    assessmentId,
    assessmentTitle,
    createdAt,
    createdBy,
    decisionTree,
    exportIncludePkgs,
    getAnswerText,
    model,
    obligationsCatalog,
    path,
    t,
    updatedAt,
  ]);

  const bumpVersion = useCallback((current) => {
    const m = /^v(\d+)/.exec(current || 'v1.0');
    const major = m ? parseInt(m[1], 10) + 1 : 1;
    return `v${major}.0`;
  }, []);

  /**
   * UI-Trigger für den PDF-Export
   * - Bereitet Tabellen-/Listenstrukturen für die PDF-Layoutlogik auf (Pfad, gruppierte fehlende Anforderungen, Pakete)
   * - Erhöht nach erfolgreichem Export die Assessment-Version (Revision) und persistiert diese in localStorage
   */
  const handleExportPDF = useCallback(async () => {
    if (isExporting) return;

    setIsExporting(true);

    try {
      const versionForExport = assessmentVersion;
      const payload = buildExportPayload(versionForExport);

      // (1) Pfad: 3 Spalten -> Schritt | Frage | Antwort
      // Schritt-Spalte: nur Zahl, stabil aus Reihenfolge der Liste
      const pathRows = (payload.path || []).map((p, idx) => [
        String(idx + 1),
        p?.label ?? '',
        p?.answer ?? '',
      ]);

      const flatMissing = Object.entries(payload.missing || {}).flatMap(([leafId, reqs]) => {
        const leafLabel = decisionTree[leafId]?.label ?? leafId;
        return (reqs || []).map((r) => ({ ...r, leafId, leafLabel }));
      });

      const groupedMissing = groupMissingByRegulationAndFirstArticleOnce(flatMissing, t);

      const hasMissing = Object.values(payload.missing || {}).some(
        (reqs) => Array.isArray(reqs) && reqs.length > 0
      );
      
      //(3) Pflichtenpakete: nicht als Tabelle, sondern als Bullet-Liste (Gruppen nach Leaf)
      const packageGroups =
        hasMissing && payload.packagesByLeaf
          ? Object.entries(payload.packagesByLeaf)
              .map(([leafId, pkgs]) => {
                const leafLabel = decisionTree[leafId]?.label ?? leafId;
                const packages = (pkgs || [])
                  .map((p) => p?.label ?? p?.key ?? '')
                  .filter(Boolean);
                return { leafId, leafLabel, packages };
              })
              .filter((g) => g.packages.length > 0)
          : [];

      await exportAssessmentPdf({
        title: t('pdf.title'),
        payload,
        pathRows,
        packageGroups,
        groupedMissing,
        labels: {
          fileNamePrefix: t('pdf.fileNamePrefix'),
          metaVersion: t('pdf.metaVersion'),
          metaModelVersion: t('pdf.metaModelVersion'),
          metaCreator: t('pdf.metaCreator'),
          metaUpdatedAt: t('pdf.metaUpdatedAt'),
          pathSection: t('pdf.pathSection'),
          stepColumn: t('pdf.stepColumn'),
          questionColumn: t('pdf.questionColumn'),
          answerColumn: t('pdf.answerColumn'),
          missingSection: t('pdf.missingSection'),
          unknownRegulation: t('pdf.unknownRegulation'),
          noArticleReference: t('pdf.noArticleReference'),
          missingRequirementColumn: t('pdf.missingRequirementColumn'),
          performedByColumn: t('pdf.performedByColumn'),
          controlledByColumn: t('pdf.controlledByColumn'),
        },
        locale,
      });

      const nextVersion = bumpVersion(assessmentVersion);
      setAssessmentVersion(nextVersion);
      window.localStorage.setItem('assessmentVersion', nextVersion);
    } finally {
      setIsExporting(false);
    }
  }, [
    isExporting,
    bumpVersion,
    assessmentVersion,
    buildExportPayload,
    decisionTree,
    locale,
    t,
    setAssessmentVersion,
    setIsExporting,
  ]);


  // Auswahl der zentralen Karte im Hauptbereich:
  // Der Descriptor entscheidet, welche Node-Komponente gerendert wird und welche Handler gebunden werden
  let centerCard = null;
  const stepNumber = currentStepIndex + 1;
  const cluster = descriptor.cluster ?? getClusterForNodeId(currentId, decisionTree, obligationsCatalog);

  if (descriptor.kind === 'question') {
    centerCard = (
      <QuestionNode
        data={{
          label: descriptor.label,
          step: stepNumber,
          cluster,
          answer: answers[currentId],
          disabled: false,
          onYes: () => answerNode(currentId, 'yes'),
          onNo: () => answerNode(currentId, 'no'),
          yesLabel: descriptor.yesLabel,
          noLabel: descriptor.noLabel,
          info: descriptor.info,
          examples: descriptor.examples,
          checkpointText: descriptor.checkpointText,
          reference: descriptor.reference,
          referenceUrl: descriptor.referenceUrl,
          t,
        }}
      />
    );
  } else if (descriptor.kind === 'leaf') {
    centerCard = (
      <LeafNode
        data={{
          label: descriptor.label,
          step: stepNumber,
          cluster,
          obligationKeys: descriptor.obligationKeys,
          obligationsCatalog,
          nextId: descriptor.nextId,
          onContinue: descriptor.nextId ? () => continueFromLeaf(currentId) : undefined,
          continueDisabled: !descriptor.nextId,
          onStartCheck: () => startCheck(currentId),
          checkStarted: path.some((s) => s.id.startsWith(`${currentId}__req__`)),
          checkpointText: descriptor.checkpointText,
          reference: descriptor.reference,
          referenceUrl: descriptor.referenceUrl,
          t,
        }}
      />
    );
  } else if (descriptor.kind === 'req') {
    centerCard = (
      <ReqQuestionNode
        data={{
          question: descriptor.question,
          pkgLabel: descriptor.pkgLabel,
          articles: descriptor.articles,
          step: stepNumber,
          cluster,
          answer: answers[currentId],
          disabled: false,
          onYes: () => answerNode(currentId, 'yes'),
          onNo: () => answerNode(currentId, 'no'),
          info: descriptor.info,
          examples: descriptor.examples,
          reference: descriptor.reference,
          referenceUrl: descriptor.referenceUrl,
          t,
        }}
      />
    );
  } else if (descriptor.kind === 'summary') {
    centerCard = (
      <ReqSummaryNode
        data={{
          step: stepNumber,
          cluster,
          missing: descriptor.missing,
          nextId: descriptor.nextId,
          continueDisabled: !descriptor.nextId,
          onContinue: descriptor.nextId
            ? () => continueFromSummary(descriptor.leafId)
            : undefined,
          t,
        }}
      />
    );
  } else {
    centerCard = (
      <div
        style={{
          padding: 16,
          borderRadius: 10,
          border: '1px solid #e5e7eb',
          background: '#fff',
          boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
          minWidth: 320,
        }}
      >
        <div style={{ fontWeight: 'bold', marginBottom: 6 }}>{t('wizard.unknownNode')}</div>
        <div className="rf-meta">{currentId}</div>
      </div>
    );
  }

  const assessmentMenuItems = [
    {
      key: 'save',
      label: t('persistence.save'),
      title: t('persistence.saveTitle'),
      onClick: handleSaveAssessment,
    },
    {
      key: 'load',
      label: t('persistence.load'),
      title: t('persistence.loadTitle'),
      onClick: () => {
        refreshSavedAssessments();
        setIsManagerOpen(true);
      },
    },
    {
      key: 'resetVersion',
      label: t('wizard.resetVersion'),
      title: t('wizard.resetVersionTitle'),
      onClick: resetAssessmentVersion,
    },
    {
      key: 'resetPath',
      label: t('wizard.resetPath'),
      title: t('wizard.resetPathTitle'),
      onClick: handleReset,
    },
  ];

  const exportMenuItems = [
    {
      key: 'pdf',
      label: isExporting ? t('wizard.exporting') : t('wizard.export'),
      title: t('wizard.exportTitle'),
      disabled: isExporting,
      onClick: handleExportPDF,
    },
    {
      key: 'jsonExport',
      label: t('persistence.exportJson'),
      title: t('persistence.exportJsonTitle'),
      onClick: handleExportJson,
    },
    {
      key: 'jsonImport',
      label: t('persistence.importJson'),
      title: t('persistence.importJsonTitle'),
      onClick: () => fileInputRef.current?.click(),
    },
  ];

  // Rendering-Layout:
  // - Header: Metadaten + Export-Trigger + Reset 
  // - Sidebar: klickbare Historie (Pfad) zur Navigation
  // - Main: aktuelle Frage/Leaf/Requirement/Summary (centerCard)
  // - Konsistenzverletzungen werden als Blocker-Panel im Main angezeigt (inkl. Review-Hilfe)
  return (
    <div
    className="app-root"
    >
  
      <header className="app-header">
        <div className="app-header-left app-meta-stack">
          <div
            className="app-assessment-pill"
            title={t('persistence.assessmentTitle', { value: assessmentTitle || t('persistence.untitled') })}
          >
            <span className="app-assessment-label">{t('persistence.assessmentLabel')}</span>
            <span className="app-assessment-name">{assessmentTitle || t('persistence.untitled')}</span>
          </div>
          <span className="app-model-badge">{t('pdf.metaVersion')}: {assessmentVersion}</span>
          <span className="app-model-badge">{t('persistence.modelVersion')}: {MODEL_VERSION}</span>
          <span className="rf-meta app-meta-truncate">{t('wizard.createdBy', { value: createdBy || t('common.unknown') })}</span>
        </div>

        <div className="app-header-center">
          <div className="app-title">{t('wizard.title')}</div>
        </div>

        <div className="app-header-right app-actions">
          <LanguageSwitcher locale={locale} onChange={onLocaleChange} t={t} />
          <span className="rf-meta">{t('wizard.updatedAt', { value: updatedAtLabel })}</span>

          <HeaderActionMenu
            id="assessment"
            label={t('persistence.assessmentMenu')}
            openMenu={openHeaderMenu}
            setOpenMenu={setOpenHeaderMenu}
            items={assessmentMenuItems}
          />

          <HeaderActionMenu
            id="export"
            label={t('persistence.exportMenu')}
            openMenu={openHeaderMenu}
            setOpenMenu={setOpenHeaderMenu}
            items={exportMenuItems}
          />

          <input
            ref={fileInputRef}
            type="file"
            accept="application/json,.json"
            onChange={handleImportJsonFile}
            style={{ display: 'none' }}
          />
        </div>
      </header>

      {(saveMessage || importWarning) && (
        <div
          style={{
            position: 'fixed',
            top: 72,
            right: 24,
            zIndex: 1200,
            maxWidth: 420,
            borderRadius: 10,
            border: `1px solid ${importWarning ? '#fca5a5' : '#86efac'}`,
            background: importWarning ? '#fef2f2' : '#f0fdf4',
            color: '#111827',
            padding: '10px 12px',
            fontSize: 12,
            boxShadow: '0 10px 24px rgba(15,23,42,0.12)',
          }}
        >
          <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
            <div style={{ flex: 1 }}>{importWarning || saveMessage}</div>
            <button
              type="button"
              onClick={() => {
                setSaveMessage('');
                setImportWarning('');
              }}
              style={{
                border: 'none',
                background: 'transparent',
                cursor: 'pointer',
                fontSize: 12,
                color: '#111827',
              }}
            >
              {t('common.close')}
            </button>
          </div>
        </div>
      )}

      {isManagerOpen && (
        <SavedAssessmentDialog
          assessments={savedAssessments}
          currentAssessmentId={assessmentId}
          locale={locale}
          onClose={() => setIsManagerOpen(false)}
          onLoad={handleLoadAssessment}
          onDelete={handleDeleteAssessment}
          t={t}
        />
      )}

      <div
        className="app-body"
      >

        <aside className="app-sidebar">
          <div style={{ fontWeight: 'bold', marginBottom: 8, fontSize: 13 }}>{t('wizard.pathTitle')}</div>
  
          <ol style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {path.map((step, idx) => {
              const id = step.id;
              let label = id;
  
              if (id.includes('__req__summary')) {
                const leafId = id.split('__req__')[0];
                label = t('wizard.summaryPrefix', { label: decisionTree[leafId]?.label ?? leafId });
              } else if (id.includes('__req__')) {
                const [leafId] = id.split('__req__');
                const { reqs } = getRequirementChain(leafId, model);
                const req = reqs.find((r) => r.id === id);
                label = req?.question ?? id;
              } else {
                label = decisionTree[id]?.label ?? id;
              }
  
              const isActive = idx === currentStepIndex;
  
              return (
                <li
                  key={id + idx}
                  onClick={() => jumpToStep(idx)}
                  style={{
                    padding: '6px 8px',
                    borderRadius: 6,
                    marginBottom: 4,
                    cursor: idx === currentStepIndex ? 'default' : 'pointer',
                    background: isActive ? '#e0f2fe' : 'transparent',
                    border: isActive ? '1px solid #60a5fa' : '1px solid transparent',
                    fontSize: 12,
                  }}
                >
                  <div style={{ fontWeight: isActive ? 600 : 500, marginBottom: 2 }}>
                    {idx + 1}. {label}
                  </div>
  
                  {answers[id] && (
                    <div className="rf-meta">
                      {t('wizard.answerLabel')} {getAnswerText(id, answers[id])}
                    </div>
                  )}
                </li>
              );
            })}
          </ol>
        </aside>
  
        <main className="app-main">
        <div className="app-main-inner" style={{ width: '100%', maxWidth: 960 }}>
            <div className="rf-meta" style={{ marginBottom: 12 }} />

            {consistencyViolations.length > 0 && (
              <>
                <div
                  style={{
                    marginBottom: 12,
                    padding: 12,
                    borderRadius: 12,
                    border: '1px solid #fca5a5',
                    background: '#fef2f2',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                    <div>
                      <div style={{ fontWeight: 700, marginBottom: 4 }}>{t('consistency.bannerTitle')}</div>
                      <div style={{ fontSize: 13, opacity: 0.85 }}>
                        {t('consistency.bannerText')}
                      </div>
                    </div>

                    <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                      <button
                        type="button"
                        onClick={() => setConflictHelpOpen(true)}
                        style={{
                          padding: '6px 10px',
                          borderRadius: 10,
                          border: '1px solid #e5e7eb',
                          background: 'white',
                          cursor: 'pointer',
                          fontSize: 12,
                        }}
                      >
                        {t('consistency.reviewHelp')}
                      </button>
                      <button
                        type="button"
                        onClick={() => setConsistencyViolations([])}
                        style={{
                          padding: '6px 10px',
                          borderRadius: 10,
                          border: '1px solid #e5e7eb',
                          background: 'white',
                          cursor: 'pointer',
                          fontSize: 12,
                        }}
                      >
                        {t('common.close')}
                      </button>
                    </div>
                  </div>

                  <div style={{ marginTop: 12, display: 'grid', gap: 10 }}>
                    {consistencyViolations.map((v, idx) => (
                      <div
                        key={`${v.code}-${idx}`}
                        style={{
                          background: 'white',
                          border: '1px solid #fee2e2',
                          borderRadius: 12,
                          padding: 12,
                        }}
                      >
                        <div style={{ fontWeight: 600 }}>{v.message}</div>

                        {Array.isArray(v.conflicts) && v.conflicts.length > 0 && (
                          <div style={{ marginTop: 8 }}>
                            <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>
                              {t('consistency.generatedBy')}
                            </div>
                            <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12, display: 'grid', gap: 4 }}>
                              {v.conflicts.map((c, cIdx) => {
                                const canJump = path.some((n) => n.id === c.nodeId);
                                return (
                                  <li key={`${c.nodeId}-${cIdx}`}>
                                    <button
                                      type="button"
                                      disabled={!canJump}
                                      onClick={() => canJump && jumpToNodeId(c.nodeId)}
                                      style={{
                                        marginRight: 8,
                                        padding: 0,
                                        border: 'none',
                                        background: 'transparent',
                                        color: canJump ? '#2563eb' : '#6b7280',
                                        textDecoration: canJump ? 'underline' : 'none',
                                        cursor: canJump ? 'pointer' : 'not-allowed',
                                        fontSize: 12,
                                        fontWeight: 600,
                                      }}
                                    >
                                      {c.nodeId}
                                    </button>
                                    <span style={{ opacity: 0.85 }}>{c.label}</span>
                                    {c.answer && c.answer !== '-' && (
                                      <span style={{ marginLeft: 8, opacity: 0.9 }}>
                                        · {t('wizard.answerLabel')} <b>{c.answer}</b>
                                      </span>
                                    )}
                                    {c.note && <span style={{ marginLeft: 8, opacity: 0.75 }}>· {c.note}</span>}
                                  </li>
                                );
                              })}
                            </ul>
                          </div>
                        )}

                        {Array.isArray(v.recommendations) && v.recommendations.length > 0 && (
                          <div style={{ marginTop: 10, fontSize: 12 }}>
                            <div style={{ fontWeight: 600, marginBottom: 6 }}>{t('consistency.recommendation')}</div>
                            <ul style={{ margin: 0, paddingLeft: 18, display: 'grid', gap: 4 }}>
                              {v.recommendations.map((r, i) => (
                                <li key={i}>{r}</li>
                              ))}
                            </ul>
                          </div>
                        )}

                        {v.primaryActionNodeId && path.some((n) => n.id === v.primaryActionNodeId) && (
                          <div style={{ marginTop: 10 }}>
                            <button
                              type="button"
                              onClick={() => jumpToNodeId(v.primaryActionNodeId)}
                              style={{
                                padding: '6px 10px',
                                borderRadius: 10,
                                border: '1px solid #e5e7eb',
                                background: 'white',
                                cursor: 'pointer',
                                fontSize: 12,
                                fontWeight: 600,
                              }}
                            >
                              {t('consistency.reviewStep')}
                            </button>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>

                {conflictHelpOpen && (
                  <div
                    role="dialog"
                    aria-modal="true"
                    style={{
                      position: 'fixed',
                      inset: 0,
                      background: 'rgba(0,0,0,0.45)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      padding: 16,
                      zIndex: 9999,
                    }}
                    onClick={() => setConflictHelpOpen(false)}
                  >
                    <div
                      style={{
                        width: 'min(860px, 100%)',
                        maxHeight: '85vh',
                        overflow: 'auto',
                        borderRadius: 14,
                        background: 'white',
                        border: '1px solid #e5e7eb',
                        padding: 16,
                      }}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                        <div>
                          <div style={{ fontWeight: 800, fontSize: 16 }}>
                            {decisionTree.W_KI_WIDERSPRUCH?.label || t('consistency.dialogTitleFallback')}
                          </div>
                          {decisionTree.W_KI_WIDERSPRUCH?.info && (
                            <div style={{ marginTop: 8, fontSize: 13, opacity: 0.9 }}>
                              {decisionTree.W_KI_WIDERSPRUCH.info}
                            </div>
                          )}
                        </div>

                        <button
                          type="button"
                          onClick={() => setConflictHelpOpen(false)}
                          style={{
                            padding: '6px 10px',
                            borderRadius: 10,
                            border: '1px solid #e5e7eb',
                            background: 'white',
                            cursor: 'pointer',
                            fontSize: 12,
                            height: 'fit-content',
                          }}
                        >
                          {t('common.close')}
                        </button>
                      </div>

                      {decisionTree.W_KI_WIDERSPRUCH?.examples && (
                        <div style={{ marginTop: 12 }}>
                          <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 6 }}>{t('consistency.dialogApproach')}</div>
                          {Array.isArray(decisionTree.W_KI_WIDERSPRUCH.examples) ? (
                            <ul style={{ margin: 0, paddingLeft: 18, display: 'grid', gap: 6, fontSize: 13 }}>
                              {decisionTree.W_KI_WIDERSPRUCH.examples.map((ex, i) => (
                                <li key={i}>{ex}</li>
                              ))}
                            </ul>
                          ) : (
                            <div style={{ fontSize: 13, opacity: 0.9 }}>{decisionTree.W_KI_WIDERSPRUCH.examples}</div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </>
            )}
            {centerCard}
          </div>
        </main>
      </div>
    </div>
  );
}  

/**
 * Minimaler View-Router für die drei App-Phasen:
 * - welcome: Intro
 * - creator: Ersteller erfassen
 * - wizard: eigentlicher Entscheidungsbaum (mit ErrorBoundary als Schutzschicht)
 */
export default function App() {
  const [view, setView] = useState('welcome'); 
  const [creator, setCreator] = useState('');
  const [assessmentTitle, setAssessmentTitle] = useState('');
  const [loadedAssessment, setLoadedAssessment] = useState(null);
  const [savedAssessments, setSavedAssessments] = useState(() => listSavedAssessments());
  const [isWelcomeManagerOpen, setIsWelcomeManagerOpen] = useState(false);
  const [locale, setLocale] = useState(() => getStoredLocale());
  const welcomeFileInputRef = useRef(null);
  const t = useMemo(() => createTranslator(locale), [locale]);

  useEffect(() => {
    try {
      window.localStorage.setItem(LOCALE_STORAGE_KEY, locale);
    } catch {
      return;
    }
  }, [locale]);

  const resetApp = useCallback(() => {
    setCreator('');
    setAssessmentTitle('');
    setLoadedAssessment(null);
    setView('welcome');
  }, []);

  const refreshWelcomeAssessments = useCallback(() => {
    setSavedAssessments(listSavedAssessments());
  }, []);

  const prepareLoadedAssessment = useCallback((assessment) => {
    const normalized = normalizeAssessment(assessment);
    setCreator('');
    setAssessmentTitle(normalized.title || '');
    setLoadedAssessment(normalized);
    setIsWelcomeManagerOpen(false);
    setView('creator');
  }, []);

  const handleWelcomeDeleteAssessment = useCallback((assessmentId) => {
    if (!window.confirm(t('persistence.deleteConfirm'))) return;
    deleteAssessment(assessmentId);
    refreshWelcomeAssessments();
  }, [refreshWelcomeAssessments, t]);

  const handleWelcomeImportJsonFile = useCallback(async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    try {
      const parsed = JSON.parse(await file.text());
      const validation = validateImportedAssessment(parsed);
      if (!validation.ok) {
        window.alert(validation.error);
        return;
      }

      const imported = normalizeAssessment({
        ...parsed,
        assessmentId: parsed.assessmentId || createAssessmentId(),
        updatedAt: new Date().toISOString(),
      });

      const saved = saveAssessment(imported);
      refreshWelcomeAssessments();
      prepareLoadedAssessment(saved);
    } catch (error) {
      window.alert(`${t('persistence.importError')} ${error?.message ?? ''}`.trim());
    }
  }, [prepareLoadedAssessment, refreshWelcomeAssessments, t]);

  const handleAssessmentLoaded = useCallback((assessment) => {
    setCreator(assessment.createdBy || '');
    setAssessmentTitle(assessment.title || '');
    setLoadedAssessment(assessment);
    setView('wizard');
  }, []);

  let content = null;

  if (view === 'welcome') {
    content = (
      <>
        <WelcomeScreen
          onStart={() => {
            setCreator('');
            setAssessmentTitle('');
            setLoadedAssessment(null);
            setView('creator');
          }}
          onLoad={() => {
            refreshWelcomeAssessments();
            setIsWelcomeManagerOpen(true);
          }}
          onImport={() => welcomeFileInputRef.current?.click()}
          locale={locale}
          onLocaleChange={setLocale}
          t={t}
        />

        <input
          ref={welcomeFileInputRef}
          type="file"
          accept="application/json,.json"
          onChange={handleWelcomeImportJsonFile}
          style={{ display: 'none' }}
        />

        {isWelcomeManagerOpen && (
          <SavedAssessmentDialog
            assessments={savedAssessments}
            currentAssessmentId={loadedAssessment?.assessmentId}
            locale={locale}
            onClose={() => setIsWelcomeManagerOpen(false)}
            onLoad={prepareLoadedAssessment}
            onDelete={handleWelcomeDeleteAssessment}
            t={t}
          />
        )}
      </>
    );
  } else if (view === 'creator') {
    content = (
      <CreatorScreen
        creator={creator}
        onCreatorChange={setCreator}
        title={assessmentTitle}
        onTitleChange={setAssessmentTitle}
        requireTitle={!loadedAssessment}
        onBack={() => setView('welcome')}
        locale={locale}
        onLocaleChange={setLocale}
        t={t}
        onConfirm={() => {
          if (creator.trim() && (loadedAssessment || assessmentTitle.trim())) {
            setView('wizard');
          }
        }}
      />
    );
  } else {
    content = (
      <ErrorBoundary
        onReset={resetApp}
        messages={{
          title: t('errorBoundary.title'),
          unknownError: t('errorBoundary.unknownError'),
          reset: t('errorBoundary.reset'),
          reload: t('errorBoundary.reload'),
          details: t('errorBoundary.details'),
        }}
      >
        <Wizard
          createdBy={creator || t('common.unknown')}
          assessmentTitle={assessmentTitle || t('persistence.untitled')}
          locale={locale}
          onLocaleChange={setLocale}
          initialAssessment={loadedAssessment}
          onAssessmentLoaded={handleAssessmentLoaded}
          t={t}
        />
      </ErrorBoundary>
    );
  }

  return (
    <>
      <style>{uiCSS}</style>
      {content}
    </>
  );
}
