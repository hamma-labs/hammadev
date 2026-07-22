import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import fs from 'node:fs';
import path from 'path';

const rootPackage = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, '../package.json'), 'utf8'),
) as { version: string };
const productContract = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, '../product-contract.json'), 'utf8'),
) as { installCommand: string; websiteCommands: Record<string, string> };

export default defineConfig({
  plugins: [react()],
  define: {
    __HAMMA_VERSION__: JSON.stringify(rootPackage.version),
    __HAMMA_INSTALL_COMMAND__: JSON.stringify(productContract.installCommand),
    __HAMMA_WEBSITE_COMMANDS__: JSON.stringify(productContract.websiteCommands),
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5173,
    host: true,
  },
});
