// A generic recursive type, returned by the router as concrete instantiations.
export interface Tree<T> {
  value: T;
  children: Tree<T>[];
}

export interface Label {
  readonly text: string;
}
