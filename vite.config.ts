import { defineConfig, Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';

function plotApiPlugin(): Plugin {
  return {
    name: 'plot-api-plugin',
    configureServer(server) {
      server.middlewares.use('/api/plot', (req, res) => {
        if (req.method === 'POST') {
          let body = '';
          req.on('data', (chunk) => {
            body += chunk;
          });
          req.on('end', () => {
            try {
              const data = JSON.parse(body);
              const tmpDir = path.resolve(process.cwd(), 'temp');
              if (!fs.existsSync(tmpDir)) {
                fs.mkdirSync(tmpDir, { recursive: true });
              }
              const jsonFile = path.join(tmpDir, `telemetry_${Date.now()}.json`);
              fs.writeFileSync(jsonFile, JSON.stringify(data, null, 2), 'utf-8');

              const scriptFile = path.resolve(
                process.cwd(),
                'scripts',
                'plot_rover_telemetry.py'
              );

              // Launch python script detached so TkAgg GUI window pops up on Windows
              const py = spawn('python', [scriptFile, jsonFile], {
                detached: true,
                stdio: 'ignore',
                windowsHide: false,
              });
              py.unref();

              res.setHeader('Content-Type', 'application/json');
              res.end(
                JSON.stringify({
                  success: true,
                  message: 'Matplotlib GUI window launched',
                  file: jsonFile,
                })
              );
            } catch (err: any) {
              res.statusCode = 500;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ success: false, error: err.message }));
            }
          });
        } else {
          res.statusCode = 405;
          res.end('Method Not Allowed');
        }
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), plotApiPlugin()],
  server: {
    port: 5173,
    open: false,
  },
  build: {
    target: 'es2022',
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks: {
          'three-vendor': ['three', '@react-three/fiber', '@react-three/drei'],
        },
      },
    },
  },
});
