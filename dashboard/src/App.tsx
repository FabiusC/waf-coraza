import { useEffect, useMemo, useState } from 'react';
import type { Snapshot } from './types';

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
  path: string;
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
    title: 'Control legitimo',
    description: 'Peticion normal a /app. Debe pasar sin bloqueo.',
    path: '/app',
    expectedBlocked: false,
  },
  {
    id: 'admin-scan',
    title: 'Escaneo de ruta admin',
    description: 'Prueba una ruta tipica de reconocimiento.',
    path: '/admin',
    expectedBlocked: true,
  },
  {
    id: 'path-traversal',
    title: 'Intento path traversal',
    description: 'Incluye ../ para disparar deteccion de ruta sospechosa.',
    path: '/../../etc/passwd',
    expectedBlocked: true,
  },
  {
    id: 'sqli-probe',
    title: 'Sondeo SQLi',
    description: 'Incluye patron union select dentro de la URL.',
    path: '/app?q=union%20select%20username%2Cpassword',
    expectedBlocked: true,
  },
  {
    id: 'xss-probe',
    title: 'Sondeo XSS',
    description: 'Incluye un payload simple de script en query string.',
    path: '/app?q=%3Cscript%3Ealert(1)%3C/script%3E',
    expectedBlocked: true,
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

  const blockedRecent = useMemo(() => snapshot.recent.filter((event) => event.blocked), [snapshot.recent]);

  const runScenario = async (scenario: AttackScenario) => {
    setRunningScenarioId(scenario.id);
    const startedAt = new Date().toISOString();

    try {
      const response = await fetch(`${API_BASE}${scenario.path}`, { cache: 'no-store' });
      const blocked = response.status === 403;

      setAttackRuns((prev) => [
        {
          id: `${scenario.id}-${Date.now()}`,
          title: scenario.title,
          path: scenario.path,
          status: response.status,
          blocked,
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
          error: cause instanceof Error ? cause.message : 'Error de conexion',
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
          <span className="eyebrow">Coraza WAF · Netlify dashboard</span>
          <h1>Monitoreo de tráfico y amenazas en tiempo real</h1>
          <p>
            Este panel consume la API del backend en Fly.io y refleja solicitudes permitidas,
            bloqueadas y las reglas que dispararon una interrupción.
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
                <div className="run-path">{scenario.path}</div>
                <p className="muted">{scenario.description}</p>
                <button
                  className="attack-button"
                  onClick={() => runScenario(scenario)}
                  disabled={runningScenarioId !== null}
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
              <h2>Historial de validacion</h2>
            </div>
            <span className="chip">Ultimas 8</span>
          </div>

          <div className="run-list">
            {attackRuns.length === 0 ? (
              <div className="event empty-event">
                <span>Aun no se ejecutaron pruebas.</span>
              </div>
            ) : (
              attackRuns.map((run) => {
                const matchExpected = run.error ? false : run.blocked === run.expectedBlocked;
                return (
                  <div className="run-item" key={run.id}>
                    <div className="attack-item-head">
                      <strong>{run.title}</strong>
                      <span className={`pill ${matchExpected ? 'pill-ok' : 'pill-danger'}`}>
                        {matchExpected ? 'Comportamiento esperado' : 'Revisar regla'}
                      </span>
                    </div>
                    <div className="run-path">{run.path}</div>
                    <div className="run-meta muted">
                      <span>{formatTime(run.time)}</span>
                      <span>{run.error ? `Error: ${run.error}` : `HTTP ${run.status}`}</span>
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
                <div className="console-entry" key={event.transactionId + event.time}>
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
                </div>
              ))
            )}
          </div>
        </article>
      </section>

      <section className="content-grid">
        <article className="card panel">
          <div className="panel-head">
            <div>
              <span className="label">Actividad reciente</span>
              <h2>Últimas peticiones</h2>
            </div>
            <span className="chip">Auto-refresh</span>
          </div>

          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Hora</th>
                  <th>Ruta</th>
                  <th>Estado</th>
                  <th>Reglas</th>
                </tr>
              </thead>
              <tbody>
                {snapshot.recent.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="empty-cell">
                      Aún no hay tráfico registrado.
                    </td>
                  </tr>
                ) : (
                  snapshot.recent.map((event) => (
                    <tr key={event.transactionId + event.time}>
                      <td>{formatTime(event.time)}</td>
                      <td>
                        <strong>{event.method}</strong> {event.path}
                        <div className="muted">{event.clientIp}</div>
                      </td>
                      <td>
                        <span className={`pill ${event.blocked ? 'pill-danger' : 'pill-ok'}`}>
                          {event.blocked ? 'Bloqueada' : 'Permitida'}
                        </span>
                        <div className="muted">{event.status}</div>
                      </td>
                      <td>
                        <div>{event.ruleIds || 'Sin regla asociada'}</div>
                        <div className="muted">{event.messages || 'Sin mensaje'}</div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </article>

        <article className="card panel">
          <div className="panel-head">
            <div>
              <span className="label">Alertas</span>
              <h2>Últimos eventos sospechosos</h2>
            </div>
            <span className="chip danger-chip">WAF</span>
          </div>

          <div className="event-list">
            {blockedRecent.length === 0 ? (
              <div className="event empty-event">
                <span>Sin eventos maliciosos por ahora.</span>
              </div>
            ) : (
              blockedRecent.slice(0, 5).map((event) => (
                <div className="event" key={event.transactionId}>
                  <div className="event-top">
                    <strong>{event.path}</strong>
                    <span className="pill pill-danger">Ataque</span>
                  </div>
                  <div className="muted">{event.method} · {event.clientIp} · {formatTime(event.time)}</div>
                  <div className="event-detail">{event.messages || 'Coraza disparó una interrupción'}</div>
                  <div className="event-detail subtle">Reglas: {event.ruleIds || 'N/A'}</div>
                </div>
              ))
            )}
          </div>
        </article>
      </section>

      {error ? <div className="error-banner">No se pudo leer la API: {error}</div> : null}
    </main>
  );
}

export default App;