import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Configuración del empaquetador: habilita JSX/React y genera rutas relativas
// para que el resultado compilado también funcione desde una carpeta estática.
export default defineConfig({
  plugins: [react()],
  base: './',
});
