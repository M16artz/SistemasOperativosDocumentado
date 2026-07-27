import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/** Configuración de compilación y servidor de desarrollo. */
export default defineConfig({
  // Transforma JSX/TSX y activa la actualización rápida de componentes.
  plugins: [react()],
  // Las rutas relativas permiten publicar `dist` dentro de cualquier subcarpeta.
  base: './',
});
