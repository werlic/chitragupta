import jwt from 'jsonwebtoken';
import { Role } from '@prisma/client';

export interface JWTPayload {
  userId: string;
  email: string;
  name: string;
  role: Role;
  timezone?: string;
  location?: string | null;
  department?: string | null;
}

const JWT_SECRET = process.env.JWT_SECRET || 'fallback-secret-dev-only';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '24h';

export function signToken(payload: JWTPayload): string {
  return jwt.sign(payload, JWT_SECRET, {
    expiresIn: JWT_EXPIRES_IN as jwt.SignOptions['expiresIn'],
  });
}

export function verifyToken(token: string): JWTPayload | null {
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as JWTPayload;
    return decoded;
  } catch {
    return null;
  }
}

export const COOKIE_NAME = 'aim_session';
