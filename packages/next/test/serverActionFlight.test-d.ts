// Type tests: a server action takes the payload's encoded form, which Next's Flight serializer can
// send (plain objects, `Date`s), not `Schema.Class` instances.
import { describe, expectTypeOf, test } from 'vite-plus/test';
import { createServerActionCaller, useServerAction, type InputAt } from '../src/index.js';
import { noteHandlers, noteRouter } from './flight-fixtures.js';

type NoteEncoded = { readonly title: string; readonly at: Date };

describe('server action input of a Schema.Class payload', () => {
  const actions = createServerActionCaller(noteRouter, { handlers: noteHandlers });

  test('is the plain encoded object, Date kept', () => {
    expectTypeOf<InputAt<typeof noteRouter, 'note.create'>>().toEqualTypeOf<NoteEncoded>();
    expectTypeOf(actions('note.create')).parameters.toEqualTypeOf<[input: NoteEncoded]>();
    expectTypeOf(actions.nested.note.create).toBeCallableWith({ title: 'hello', at: new Date() });
  });

  test('useServerAction run takes the same plain input', () => {
    const createNote = actions('note.create');
    const useIt = () => useServerAction(createNote, { router: noteRouter, path: 'note.create' });
    expectTypeOf<ReturnType<typeof useIt>['run']>().parameters.toEqualTypeOf<
      [input: NoteEncoded]
    >();
  });
});
