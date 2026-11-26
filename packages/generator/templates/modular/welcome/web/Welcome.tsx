import { useEffect, useState } from 'react';

export function Welcome() {
  const [message, setMessage] = useState('Loading the welcome example…');
  const [error, setError] = useState(false);

  useEffect(() => {
    const request = new AbortController();
    fetch('/api/welcome', { signal: request.signal }).then(async (response) => {
      if (!response.ok) throw new Error('Welcome unavailable.');
      const payload: { data?: { message?: unknown } } = await response.json();
      if (typeof payload.data?.message !== 'string') throw new Error('Unexpected response.');
      setMessage(payload.data.message);
    }).catch(() => {
      if (!request.signal.aborted) {
        setError(true);
        setMessage('The welcome example is unavailable. Check the API and migration.');
      }
    });
    return () => request.abort();
  }, []);

  return <section aria-labelledby="welcome-heading">
    <h2 id="welcome-heading">Welcome example</h2>
    <p role={error ? 'alert' : 'status'}>{message}</p>
  </section>;
}
