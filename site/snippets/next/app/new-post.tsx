// app/new-post.tsx
'use client';
import { unwrapActionResult, useServerAction } from '@rpc-effect/next';

import { appRouter } from '@/router';

import { createPost } from './actions';

// #region hook
export function NewPost() {
  const create = useServerAction(createPost, { router: appRouter, path: 'post.create' });
  return (
    <form
      action={(form) => {
        const title = form.get('title');
        if (typeof title === 'string') void create.run({ title });
      }}
    >
      <input name="title" />
      <button disabled={create.isPending}>Create</button>
      {create.data && <p>Created {create.data.slug}</p>}
      {create.error?._tag === 'Forbidden' && <p>Forbidden: {create.error.reason}</p>}
      {create.error?._tag === 'Unauthorized' && <p>Please sign in.</p>}
    </form>
  );
}
// #endregion hook

// #region unwrap
// Without the hook: a Promise of the decoded Post, rejecting with ClientError<E>.
export async function createDraft(title: string) {
  const post = await unwrapActionResult(appRouter, 'post.create', createPost({ title }));
  return post.id;
}
// #endregion unwrap
