export class SyncRefusal extends Error {
  constructor(
    message: string,
    readonly rejectedIds: readonly string[] = [],
  ) {
    super(message);
  }
}
