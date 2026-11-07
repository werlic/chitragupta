import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { comparePassword } from '@/lib/auth/bcrypt';
import { signToken, COOKIE_NAME } from '@/lib/auth/jwt';

const LoginSchema = z.object({
  email: z.string().email('Email tidak valid'),
  password: z.string().min(1, 'Password wajib diisi'),
});

export async function POST(request: NextRequest) {
  const body = await request.json();
  const parsed = LoginSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message || 'Validasi gagal' },
      { status: 400 }
    );
  }

  const { email, password } = parsed.data;
  const user = await prisma.user.findUnique({ where: { email } });

  if (!user) {
    return NextResponse.json(
      { error: 'Email atau password salah' },
      { status: 401 }
    );
  }

  const valid = await comparePassword(password, user.password);
  if (!valid) {
    return NextResponse.json(
      { error: 'Email atau password salah' },
      { status: 401 }
    );
  }

  const token = signToken({
    userId: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    timezone: user.timezone,
    location: user.location,
    department: user.department,
  });

  const response = NextResponse.json({
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      timezone: user.timezone,
      location: user.location,
      department: user.department,
    },
  });

  response.cookies.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 60 * 60 * 24, // 24h
    path: '/',
  });

  return response;
}
