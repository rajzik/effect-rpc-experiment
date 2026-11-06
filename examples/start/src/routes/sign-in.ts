import { createFileRoute } from '@tanstack/react-router';

/** `/sign-in?user=<name>`: sets the `session` cookie the server reads and goes back to the list. */
export const Route = createFileRoute('/sign-in')({
  server: {
    handlers: {
      GET: ({ request }) => {
        const user = new URL(request.url).searchParams.get('user');
        if (user === null || user === '') {
          return Response.json({ error: 'missing ?user=<name>' }, { status: 400 });
        }
        return new Response(null, {
          status: 302,
          headers: {
            location: '/',
            'set-cookie': `session=${encodeURIComponent(user)}; HttpOnly; Path=/; SameSite=Lax`,
          },
        });
      },
    },
  },
});
