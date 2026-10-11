import type { NextConfig } from 'next';

/**
 * Origen del backend NestJS. El navegador nunca lo llama directo: Next.js reenvía /api/v1/* a este origen.
 * Así la app y la API comparten origen, la cookie HttpOnly de refresco (path /api/v1/auth, SameSite=Strict)
 * viaja sola y no hace falta abrir CORS en la API.
 */
const apiOrigin = (process.env.API_ORIGIN ?? 'http://localhost:3000').replace(/\/+$/, '');

if (!/^https?:\/\/[^/]+$/.test(apiOrigin)) {
  throw new Error(`API_ORIGIN inválido: "${apiOrigin}". Usá solo esquema + host + puerto, por ejemplo http://localhost:3000`);
}

const isDev = process.env.NODE_ENV !== 'production';

/**
 * Content Security Policy: solo recursos propios. Las fuentes se sirven desde el mismo dominio (next/font),
 * el QR fiscal se genera en el navegador (data:) y las llamadas a la API van al mismo origen.
 * 'unsafe-eval' solo en desarrollo (lo requiere el recargado en caliente de Next.js).
 */
const contentSecurityPolicy = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ''}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  `connect-src 'self'${isDev ? ' ws: wss:' : ''}`,
  "frame-ancestors 'none'",
  "form-action 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  ...(isDev ? [] : ['upgrade-insecure-requests']),
].join('; ');

const securityHeaders = [
  { key: 'Content-Security-Policy', value: contentSecurityPolicy },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=()' },
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
  ...(isDev ? [] : [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }]),
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Imagen mínima para VPS: `node .next/standalone/server.js` sin node_modules completos.
  output: 'standalone',
  sassOptions: {
    quietDeps: true,
    silenceDeprecations: ['import', 'global-builtin', 'color-functions', 'mixed-decls', 'legacy-js-api'],
  },
  async rewrites() {
    return [{ source: '/api/v1/:path*', destination: `${apiOrigin}/api/v1/:path*` }];
  },
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
};

export default nextConfig;
