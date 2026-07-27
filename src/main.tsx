import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';

// Punto de entrada: monta la aplicación en el contenedor declarado en index.html.
// StrictMode ayuda a detectar efectos secundarios inseguros durante el desarrollo.
createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
