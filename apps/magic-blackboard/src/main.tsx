import * as ReactDOM from 'react-dom/client';
import { StrictMode } from 'react';
import App from './app/app';

const root = ReactDOM.createRoot(document.getElementById('root') as HTMLElement);
root.render(
  <StrictMode>
    <App />
  </StrictMode>
);

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    const baseUrl = new URL(import.meta.env.BASE_URL, window.location.href);
    void navigator.serviceWorker.register(new URL('sw.js', baseUrl), {
      scope: baseUrl.pathname,
    });
  });
}
