import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import { App } from './App';
import { WidgetTestPage } from './components/WidgetTestPage';

const isWidgetTestRoute =
  typeof window !== 'undefined' &&
  window.location.pathname.replace(/^\/+|\/+$/g, '') === 'widget-test';

createRoot(document.getElementById('root')!).render(
  <StrictMode>{isWidgetTestRoute ? <WidgetTestPage /> : <App />}</StrictMode>
);
