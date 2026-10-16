/** Client mutual exclusion. A lease is acquired before any optimistic paint or dispatch. */
export interface WriteLease {
  rows: readonly string[];
  membership: readonly string[];
  groups: readonly string[];
  whole: boolean;
  state: "saving" | "checking" | "unconfirmed";
  versions: ReadonlyMap<string, number>;
}
export class WriteScopes {
  private leases = new Set<WriteLease>();
  private versions = new Map<string, number>();
  private record(
    rows: readonly string[],
    membership: readonly string[],
    groups: readonly string[],
    whole: boolean,
  ) {
    const changed = [
      ...rows.map((id) => `row:${id}`),
      ...groups.map((id) => `team:${id}`),
      ...(whole ? ["season"] : []),
    ];
    for (const key of changed) this.versions.set(key, (this.versions.get(key) ?? 0) + 1);
    return new Map(
      ["season", ...rows.map((id) => `row:${id}`), ...membership.map((id) => `team:${id}`)].map(
        (key) => [key, this.versions.get(key) ?? 0],
      ),
    );
  }
  current(lease: WriteLease) {
    return [...lease.versions].every(([key, value]) => (this.versions.get(key) ?? 0) === value);
  }
  acquire(
    rows: readonly string[],
    membership: readonly string[],
    groups: readonly string[] = [],
    whole = false,
  ): WriteLease | null {
    for (const current of this.leases) {
      if (
        whole ||
        current.whole ||
        rows.some((id) => current.rows.includes(id)) ||
        membership.some((team) => current.groups.includes(team)) ||
        groups.some((team) => current.membership.includes(team))
      )
        return null;
    }
    const lease: WriteLease = {
      rows,
      membership,
      groups,
      whole,
      state: "saving",
      versions: this.record(rows, membership, groups, whole),
    };
    this.leases.add(lease);
    return lease;
  }
  status(row: string, team: string | null): WriteLease["state"] | null {
    const matching = [...this.leases].filter(
      (lease) =>
        lease.whole || lease.rows.includes(row) || (team !== null && lease.groups.includes(team)),
    );
    return matching.some((lease) => lease.state === "unconfirmed")
      ? "unconfirmed"
      : (matching[0]?.state ?? null);
  }
  set(lease: WriteLease, state: WriteLease["state"]) {
    if (this.leases.has(lease)) lease.state = state;
  }
  refine(
    lease: WriteLease,
    rows: readonly string[],
    membership: readonly string[],
    groups: readonly string[],
  ) {
    if (!this.leases.has(lease)) return;
    Object.assign(lease, {
      rows,
      membership,
      groups,
      whole: false,
      versions: this.record(rows, membership, groups, false),
    });
  }
  release(lease: WriteLease) {
    this.leases.delete(lease);
  }
}
