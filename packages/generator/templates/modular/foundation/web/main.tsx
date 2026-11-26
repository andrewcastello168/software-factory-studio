import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
@@WEBIMPORTS@@
function App() {
  const [readiness, setReadiness] = useState<'checking' | 'ready' | 'unavailable'>('checking');

  useEffect(() => {
    const request = new AbortController();
    fetch('/api/ready', { signal: request.signal }).then(async (response) => {
      if (!response.ok) throw new Error('Database unavailable.');
      const payload: { data?: { status?: unknown } } = await response.json();
      if (payload.data?.status !== 'ready') throw new Error('Unexpected readiness response.');
      setReadiness('ready');
    }).catch(() => {
      if (!request.signal.aborted) setReadiness('unavailable');
    });
    return () => request.abort();
  }, []);

  return <main>
    <h1>{@@TITLE@@}</h1>
    <section aria-labelledby="database-heading">
      <h2 id="database-heading">Database connection</h2>
      <p role={readiness === 'unavailable' ? 'alert' : 'status'}>
        {readiness === 'checking' ? 'Checking PostgreSQL…' : readiness === 'ready' ? 'PostgreSQL ready.' : 'PostgreSQL unavailable.'}
      </p>
    </section>
@@WEBPANELS@@  </main>;
}

const target = document.getElementById('root');
if (!target) throw new Error('Application root is missing.');
createRoot(target).render(<App />);
