import { useEffect, useMemo, useState } from 'react';
import type { Event as TrafficEvent, Snapshot } from './types';

const API_BASE = (import.meta.env.VITE_WAF_API_URL as string | undefined)?.replace(/\/$/, '') ?? 'http://localhost:8080';

const emptySnapshot: Snapshot = {
  stats: {
    total: 0,
    allowed: 0,
    blocked: 0,
  },
  recent: [],
  generated: '--',
};

type AttackScenario = {
  id: string;
  title: string;
  description: string;
  method: string;
  path: string;
  headers?: Record<string, string>;
  body?: string;
  expectedBlocked: boolean;
};

type AttackRun = {
  id: string;
  title: string;
  path: string;
  status: number;
  blocked: boolean;
  expectedBlocked: boolean;
  error: string | null;
  time: string;
};

const attackScenarios: AttackScenario[] = [
  {
    id: 'control',
    title: 'Control legítimo',
    description: 'Petición normal a /app. Debe pasar sin bloqueo.',
    method: 'GET',
    path: '/app',
    expectedBlocked: false,
  },
  {
    id: 'admin-scan',
    title: 'Escaneo de ruta admin',
    description: 'Prueba una ruta típica de reconocimiento.',
    method: 'GET',
    path: '/admin',
    expectedBlocked: true,
  },
  {
    id: 'path-traversal',
    title: 'Intento path traversal',
    description: 'Incluye traversal en parámetro file para disparar la regla ARGS.',
    method: 'GET',
    path: '/app?file=../../etc/passwd',
    expectedBlocked: true,
  },
  {
    id: 'sqli-probe',
    title: 'Sondeo SQLi',
    description: 'Incluye patrón union select dentro de la URL.',
    method: 'GET',
    path: '/app?q=union%20select%20username%2Cpassword',
    expectedBlocked: true,
  },
  {
    id: 'xss-probe',
    title: 'Sondeo XSS',
    description: 'Incluye un payload simple de script en query string.',
    method: 'GET',
    path: '/app?q=%3Cscript%3Ealert(1)%3C/script%3E',
    expectedBlocked: true,
  },
  {
    id: 'body-probe',
    title: 'Carga HTTP con body',
    description: 'Envía JSON con headers extra para inspeccionar body, URL y cabeceras.',
    method: 'POST',
    path: '/app?source=dashboard-body',
    headers: {
      'Content-Type': 'application/json',
      'X-Debug-Trace': 'dashboard',
    },
    body: JSON.stringify(
      {
        message: 'hola desde el dashboard',
        role: 'tester',
        nested: { ok: true },
      },
      null,
      2,
    ),
    expectedBlocked: false,
  },
];

function formatTime(value: string) {
  if (!value) return '--';

  return new Date(value).toLocaleTimeString('es-ES', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function App() {
  const [snapshot, setSnapshot] = useState<Snapshot>(emptySnapshot);
  const [error, setError] = useState<string | null>(null);
  const [attackRuns, setAttackRuns] = useState<AttackRun[]>([]);
  const [runningScenarioId, setRunningScenarioId] = useState<string | null>(null);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;

    const load = async () => {
      try {
        const response = await fetch(`${API_BASE}/api/stats`, { cache: 'no-store' });
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        const data = (await response.json()) as Snapshot;
        if (mounted) {
          setSnapshot(data);
          setError(null);
        }
      } catch (cause) {
        if (mounted) {
          setError(cause instanceof Error ? cause.message : 'No se pudo conectar con el backend');
        }
      }
    };

    load();
    const interval = window.setInterval(load, 2000);

    return () => {
      mounted = false;
      window.clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    if (!snapshot.recent.length) {
      setSelectedEventId(null);
      return;
    }

    const hasSelection = snapshot.recent.some((event) => event.transactionId === selectedEventId);
    if (!hasSelection) {
      setSelectedEventId(snapshot.recent[0].transactionId);
    }
  }, [selectedEventId, snapshot.recent]);

  const selectedEvent = useMemo<TrafficEvent | null>(() => {
    if (!snapshot.recent.length) {
      return null;
    }

    return snapshot.recent.find((event) => event.transactionId === selectedEventId) ?? snapshot.recent[0];
  }, [selectedEventId, snapshot.recent]);

  const blockedRecent = useMemo(() => snapshot.recent.filter((event) => event.blocked), [snapshot.recent]);

  const runScenario = async (scenario: AttackScenario) => {
    setRunningScenarioId(scenario.id);
    const startedAt = new Date().toISOString();

    try {
      const response = await fetch(`${API_BASE}${scenario.path}`, {
        method: scenario.method,
        headers: scenario.headers,
        body: scenario.body,
        credentials: 'include',
        cache: 'no-store',
      });

      setAttackRuns((prev) => [
        {
          id: `${scenario.id}-${Date.now()}`,
          title: scenario.title,
          path: scenario.path,
          status: response.status,
          blocked: response.status === 403,
          expectedBlocked: scenario.expectedBlocked,
          error: null,
          time: startedAt,
        },
        ...prev,
      ].slice(0, 8));
    } catch (cause) {
      setAttackRuns((prev) => [
        {
          id: `${scenario.id}-${Date.now()}`,
          title: scenario.title,
          path: scenario.path,
          status: 0,
          blocked: false,
          expectedBlocked: scenario.expectedBlocked,
          error: cause instanceof Error ? cause.message : 'Error de conexión',
          time: startedAt,
        },
        ...prev,
      ].slice(0, 8));
    } finally {
      setRunningScenarioId(null);
    }
  };

  return (
    <main className="page-shell">
      <section className="hero-grid">
        <article className="hero card">
          <span className="eyebrow">Coraza WAF · Dashboard</span>
          <h1>Monitoreo de tráfico y amenazas en tiempo real</h1>
          <p>
            Este panel consume la API del backend y muestra las solicitudes permitidas, bloqueadas
            y el detalle HTTP de cada evento para inspección manual.
          </p>
          <div className="hero-meta">
            <span>API: {API_BASE}</span>
            <span>Actualizado: {snapshot.generated}</span>
          </div>
        </article>

        <aside className="card status-card">
          <div className="status-item">
            <span className="label">Estado</span>
            <strong>Conectado</strong>
          </div>
          <div className="status-item">
            <span className="label">Total</span>
            <strong>{snapshot.stats.total}</strong>
          </div>
          <div className="status-item">
            <span className="label">Bloqueadas</span>
            <strong>{snapshot.stats.blocked}</strong>
          </div>
          <div className="status-item">
            <span className="label">Permitidas</span>
            <strong>{snapshot.stats.allowed}</strong>
          </div>
        </aside>
      </section>

      <section className="metrics-grid">
        <article className="card metric">
          <span className="label">Total de solicitudes</span>
          <strong>{snapshot.stats.total}</strong>
          <p>Todo el tráfico que atravesó el middleware.</p>
        </article>
        <article className="card metric">
          <span className="label">Solicitudes permitidas</span>
          <strong>{snapshot.stats.allowed}</strong>
          <p>Peticiones normales que llegaron al backend.</p>
        </article>
        <article className="card metric danger">
          <span className="label">Eventos bloqueados</span>
          <strong>{snapshot.stats.blocked}</strong>
          <p>Solicitudes que Coraza consideró maliciosas.</p>
        </article>
        <article className="card metric">
          <span className="label">Bloqueos recientes</span>
          <strong>{blockedRecent.length}</strong>
          <p>Últimas entradas marcadas por el WAF.</p>
        </article>
      </section>

      <section className="attack-grid">
        <article className="card panel">
          <div className="panel-head">
            <div>
              <span className="label">Laboratorio WAF</span>
              <h2>Pruebas controladas desde el dashboard</h2>
            </div>
            <span className="chip danger-chip">Testing</span>
          </div>

          <div className="attack-list">
            {attackScenarios.map((scenario) => (
              <div className="attack-item" key={scenario.id}>
                <div className="attack-item-head">
                  <strong>{scenario.title}</strong>
                  <span className={`pill ${scenario.expectedBlocked ? 'pill-danger' : 'pill-ok'}`}>
                    {scenario.expectedBlocked ? 'Debe bloquear' : 'Debe permitir'}
                  </span>
                </div>
                <div className="run-path">
                  {scenario.method} {scenario.path}
                </div>
                <p className="muted">{scenario.description}</p>
                <button
                  className="attack-button"
                  onClick={() => runScenario(scenario)}
                  disabled={runningScenarioId !== null}
                  type="button"
                >
                  {runningScenarioId === scenario.id ? 'Ejecutando...' : 'Ejecutar prueba'}
                </button>
              </div>
            ))}
          </div>
        </article>

        <article className="card panel">
          <div className="panel-head">
            <div>
              <span className="label">Resultado</span>
              <h2>Historial de validación</h2>
            </div>
            <span className="chip">Últimas 8</span>
          </div>

          <div className="run-list">
            {attackRuns.length === 0 ? (
              <div className="event empty-event">
                <span>Aún no se ejecutaron pruebas.</span>
              </div>
            ) : (
              attackRuns.map((run) => {
                let resultLabel = '';
                let resultClass = '';

                if (run.error) {
                  resultLabel = 'ERROR DE CONEXIÓN';
                  resultClass = 'result-error';
                } else if (run.blocked) {
                  resultLabel = '✓ BLOQUEADO por WAF';
                  resultClass = 'result-blocked';
                } else if (run.expectedBlocked) {
                  resultLabel = '✗ NO BLOQUEADO (debería estarlo)';
                  resultClass = 'result-missed';
                } else {
                  resultLabel = '✓ PERMITIDO (correcto)';
                  resultClass = 'result-allowed';
                }

                return (
                  <div className={`run-item ${resultClass}`} key={run.id}>
                    <div className="attack-item-head">
                      <strong>{run.title}</strong>
                      <span className={`pill pill-result ${resultClass}`}>{resultLabel}</span>
                    </div>
                    <div className="run-path">{run.path}</div>
                    <div className="run-meta muted">
                      <span>{formatTime(run.time)}</span>
                      <span>HTTP {run.status || 'N/A'}</span>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </article>
      </section>

      <section className="console-section">
        <article className="card panel">
          <div className="panel-head">
            <div>
              <span className="label">Consola de tráfico</span>
              <h2>Detalle completo de solicitudes</h2>
            </div>
            <span className="chip">Tiempo real</span>
          </div>

          <div className="console-wrap">
            {snapshot.recent.length === 0 ? (
              <div className="console-empty">
                <span>$ # Sin tráfico registrado</span>
              </div>
            ) : (
              snapshot.recent.map((event) => (
                <button
                  className={`console-entry ${selectedEvent?.transactionId === event.transactionId ? 'is-selected' : ''}`}
                  key={`${event.transactionId}-${event.time}`}
                  onClick={() => setSelectedEventId(event.transactionId)}
                  type="button"
                >
                  <div className="console-header">
                    <span className={`console-status ${event.blocked ? 'blocked' : 'allowed'}`}>
                      {event.status}
                    </span>
                    <span className="console-time">{formatTime(event.time)}</span>
                    <span className="console-from">{event.clientIp}</span>
                  </div>
                  <div className="console-command">
                    <code>{event.curlCommand || `curl '${event.method} ${event.path}'`}</code>
                  </div>
                  {event.messages && (
                    <div className="console-message">
                      <span className="console-label">WAF:</span>
                      <span className="console-text">{event.messages}</span>
                    </div>
                  )}
                  {event.ruleIds && (
                    <div className="console-rules">
                      <span className="console-label">Reglas:</span>
                      <span className="console-text">{event.ruleIds}</span>
                    </div>
                  )}
                  <div className="console-divider">—</div>
                </button>
              ))
            )}
          </div>
        </article>
      </section>

      <section className="inspection-grid">
        <article className="card panel inspector-panel">
          <div className="panel-head">
            <div>
              <span className="label">Inspector HTTP</span>
              <h2>URL, headers, cookies y body</h2>
            </div>
            <span className="chip">Selecciona una solicitud</span>
          </div>

          {!selectedEvent ? (
            <div className="empty-cell">Todavía no hay eventos para inspeccionar.</div>
          ) : (
            <>
              <div className="detail-hero">
                <div>
                  <span className={`pill ${selectedEvent.blocked ? 'pill-danger' : 'pill-ok'}`}>
                    {selectedEvent.blocked ? 'Bloqueada' : 'Permitida'}
                  </span>
                  <h3>
                    {selectedEvent.method} {selectedEvent.path}
                  </h3>
                  <div className="muted">URL completa: {selectedEvent.url}</div>
                </div>
                <div className="detail-meta">
                  <span>IP: {selectedEvent.clientIp}</span>
                  <span>HTTP {selectedEvent.status}</span>
                  <span>{selectedEvent.durationMs} ms</span>
                </div>
              </div>

              <div className="detail-grid">
                <article className="detail-card">
                  <span className="detail-label">Headers</span>
                  {selectedEvent.headers.length === 0 ? (
                    <div className="detail-empty">Sin headers registrados.</div>
                  ) : (
                    <div className="kv-list">
                      {selectedEvent.headers.map((header) => (
                        <div className="kv-item" key={`${header.name}-${header.value}`}>
                          <span className="kv-key">{header.name}</span>
                          <span className="kv-value">{header.value}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </article>

                <article className="detail-card">
                  <span className="detail-label">Cookies</span>
                  {selectedEvent.cookies.length === 0 ? (
                    <div className="detail-empty">Sin cookies visibles en este request.</div>
                  ) : (
                    <div className="kv-list">
                      {selectedEvent.cookies.map((cookie) => (
                        <div className="kv-item" key={`${cookie.name}-${cookie.value}`}>
                          <span className="kv-key">{cookie.name}</span>
                          <span className="kv-value">{cookie.value}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </article>

                <article className="detail-card detail-card-wide">
                  <span className="detail-label">Body HTTP</span>
                  <pre className="body-preview">{selectedEvent.body || 'Sin body en este request.'}</pre>
                </article>
              </div>

              <div className="detail-footer">
                <div>
                  <span className="detail-label">WAF</span>
                  <div className="muted">{selectedEvent.messages || 'Sin mensaje de reglas activadas.'}</div>
                </div>
                <div>
                  <span className="detail-label">Reglas</span>
                  <div className="muted">{selectedEvent.ruleIds || 'Sin regla asociada'}</div>
                </div>
                <div>
                  <span className="detail-label">Curl</span>
                  <div className="detail-curl">{selectedEvent.curlCommand || 'Sin curl generado'}</div>
                </div>
              </div>
            </>
          )}
        </article>
      </section>

      {error ? <div className="error-banner">No se pudo leer la API: {error}</div> : null}
    </main>
  );
}

export default App;