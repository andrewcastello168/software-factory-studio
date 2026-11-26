import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';

function App() {
  const [message, setMessage] = useState('Checking the database connection…');
  const [error, setError] = useState(false);

  useEffect(() => {
    const request = new AbortController();
    fetch('/api/welcome', { signal: request.signal }).then(async (response) => {
      if (!response.ok) throw new Error('Request failed.');
      const payload: { data?: { message?: unknown } } = await response.json();
      if (typeof payload.data?.message !== 'string') throw new Error('Unexpected response.');
      setMessage(payload.data.message);
    }).catch(() => {
      if (!request.signal.aborted) {
        setError(true);
        setMessage('The welcome message is unavailable. Check the API and PostgreSQL migration.');
      }
    });
    return () => request.abort();
  }, []);

  return <main>
    <h1>{@@TITLE@@}</h1>
    <p>This application connects an independent React frontend to an Express API.</p>
    <section aria-labelledby="connection-heading">
      <h2 id="connection-heading">Database connection</h2>
      <p role={error ? 'alert' : 'status'}>{message}</p>
    </section>
  </main>;
}

const target = document.getElementById('root');
if (!target) throw new Error('Application root is missing.');
createRoot(target).render(<App />);
