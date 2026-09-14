export const JWT_SECRET = process.env.JWT_SECRET || 'netfly-secret-jwt-key-2026-secure';
export const JWT_EXPIRES_IN = '24h';
export const PORT = parseInt(process.env.PORT || '3001', 10);
export const CORS_ORIGINS = process.env.CORS_ORIGINS || '*';