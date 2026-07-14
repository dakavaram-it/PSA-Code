import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Frontend talks to the read-only API at http://localhost:4000 (CORS enabled there).
export default defineConfig({
  plugins: [react()],
});
