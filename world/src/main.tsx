import React from 'react';
import ReactDOM from 'react-dom/client';
import '@fontsource/m-plus-rounded-1c/latin-500.css';
import '@fontsource/m-plus-rounded-1c/latin-700.css';
import '@fontsource/m-plus-rounded-1c/latin-800.css';
import '@fontsource/anton/latin-400.css';
import './styles.css';
import { configure, worldConfig, type WorldConfig } from './config';
import { loadWorldData } from './data';
import { trackWorldOpened } from './analytics';

/** Company look on the document: brand tokens as CSS vars, tab title and favicon. */
function applyBrand(cfg: WorldConfig) {
  const root = document.documentElement.style;
  root.setProperty('--brand', cfg.brand.primary);
  root.setProperty('--accent', cfg.brand.accent);
  document.title = `${cfg.company.name} onboarding`;
  if (cfg.company.logoUrl) {
    let link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
    if (!link) {
      link = document.createElement('link');
      link.rel = 'icon';
      document.head.appendChild(link);
    }
    link.href = cfg.company.logoUrl;
  }
}

async function start() {
  const { data } = await loadWorldData();
  const cfg = worldConfig(data);
  configure(cfg);
  // Progress, credits and saves are per hire: they load when the hire signs in (economy.signInHire).
  applyBrand(cfg);
  trackWorldOpened(cfg);
  // The screens read the configured world at import time, so load them after configure().
  const { default: App } = await import('./App');
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
}

start();
