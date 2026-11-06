// Server-only: the generated client module must never import this.
import { Post } from './models.js';

export const db = {
  posts: [
    new Post({ id: 1, title: 'Hello Effect', createdAt: new Date('2026-01-01T00:00:00.000Z') }),
    new Post({ id: 2, title: 'Typed errors', createdAt: new Date('2026-02-01T00:00:00.000Z') }),
  ],
  secret: 'server-only',
};
