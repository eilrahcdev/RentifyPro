<<<<<<< HEAD
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
=======
<<<<<<< HEAD
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
>>>>>>> 8422a2f (fixed bugs and updates)

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
<<<<<<< HEAD
})
=======
  server: {
    proxy: { '/api': 'http://localhost:5000' }
  }
}); 
=======
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
})
>>>>>>> 8745d21 (fixed bugs and updates)
>>>>>>> 8422a2f (fixed bugs and updates)
