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