export interface ActorBindingReceipt {
  actorId: string;
  valid: () => boolean;
}
interface ActorBindingStorage {
  stopped: () => boolean;
  stopGeneration: () => number;
  reopen: () => void;
  readActor: () => Promise<string | undefined>;
  stop: () => number;
  purge: () => Promise<void>;
  writeActor: (actor: string, valid: () => boolean) => Promise<void>;
}

/** Coalesce sibling initializers; any newer binding or stop cancels old work. */
export function createActorBinder(storage: ActorBindingStorage) {
  let sequence = 0;
  let pending: { actorId: string; promise: Promise<ActorBindingReceipt> } | undefined;
  return (actorId: string): Promise<ActorBindingReceipt> => {
    if (pending?.actorId === actorId) return pending.promise;
    const operation = ++sequence;
    let stopGeneration = storage.stopGeneration();
    const valid = () =>
      operation === sequence && stopGeneration === storage.stopGeneration() && !storage.stopped();
    const assert = () => {
      if (!valid()) throw new Error("Account storage binding changed. Reload after signing in.");
    };
    const promise = (async () => {
      // Only a new authenticated page may start this binding. A mounted,
      // stopped consumer never automatically calls it to resume itself.
      if (storage.stopped()) storage.reopen();
      assert();
      const previous = await storage.readActor();
      assert();
      if (previous && previous !== actorId) {
        stopGeneration = storage.stop();
        await storage.purge();
        if (operation !== sequence || stopGeneration !== storage.stopGeneration())
          throw new Error("Account storage binding was canceled during its purge.");
        storage.reopen();
        assert();
      }
      await storage.writeActor(actorId, valid);
      assert();
      return { actorId, valid };
    })();
    pending = { actorId, promise };
    void promise.then(
      () => {
        if (pending?.promise === promise) pending = undefined;
      },
      () => {
        if (pending?.promise === promise) pending = undefined;
      },
    );
    return promise;
  };
}
