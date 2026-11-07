import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { verifyToken, COOKIE_NAME } from '@/lib/auth/jwt';

export default async function Home() {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  const payload = token ? verifyToken(token) : null;

  if (payload) {
    redirect('/dashboard');
  } else {
    redirect('/login');
  }
}
