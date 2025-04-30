import { defineConfig } from 'vite';
import fs from 'fs'
import path from 'path'

export default defineConfig({
  root: './src',
  build: {
    outDir: '../dist',
    minify: false,
    emptyOutDir: true,
  },
  server: {
    https: {
      key: fs.readFileSync(path.resolve(__dirname, 'cert/key.pem')),
      cert: fs.readFileSync(path.resolve(__dirname, 'cert/cert.pem'))
    },
    host: '0.0.0.0', // So it's accessible to your phone on local network
    port: 3000
  }
});
