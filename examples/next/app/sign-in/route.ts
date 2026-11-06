import { NextResponse, type NextRequest } from 'next/server';

export const dynamic = 'force-dynamic';

/** `/sign-in?user=<name>`: sets the `session` cookie the server reads and goes back to the list. */
export function GET(request: NextRequest) {
  const user = request.nextUrl.searchParams.get('user');
  if (user === null || user === '') {
    return NextResponse.json({ error: 'missing ?user=<name>' }, { status: 400 });
  }
  const response = NextResponse.redirect(new URL('/', request.url));
  response.cookies.set('session', user, { httpOnly: true, path: '/', sameSite: 'lax' });
  return response;
}
