import { NextRequest, NextResponse } from 'next/server';
import { jwtVerify } from 'jose';

const COOKIE_NAME = 'aim_session';
const JWT_SECRET = process.env.JWT_SECRET || 'fallback-secret-dev-only';

// Edge-compatible token verification using jose
async function verifyTokenEdge(token: string): Promise<boolean> {
  try {
    const secret = new TextEncoder().encode(JWT_SECRET);
    await jwtVerify(token, secret);
    return true;
  } catch {
    return false;
  }
}

// Protect dashboard routes — redirect to /login if no valid JWT
export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Public paths that don't require auth
  const publicPaths = ['/', '/login'];
  const isPublic = publicPaths.some((p) => pathname === p || pathname.startsWith(p + '/'));

  if (isPublic) {
    // If already logged in and visiting /login, redirect to dashboard
    if (pathname === '/login') {
      const token = request.cookies.get(COOKIE_NAME)?.value;
      if (token && await verifyTokenEdge(token)) {
        return NextResponse.redirect(new URL('/dashboard', request.url));
      }
    }
    return NextResponse.next();
  }

  // Protect everything under /dashboard, /api (except /api/auth)
  const token = request.cookies.get(COOKIE_NAME)?.value;
  const isValid = token ? await verifyTokenEdge(token) : false;

  if (!isValid) {
    // API routes return 401 JSON
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    // Pages redirect to login
    return NextResponse.redirect(new URL('/login', request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    /*
     * Match all paths except:
     * - _next/static, _next/image (static assets)
     * - favicon, public files
     * - api/auth/* (login, logout, me)
     */
    '/((?!_next/static|_next/image|favicon.ico|api/auth).*)',
  ],
};
