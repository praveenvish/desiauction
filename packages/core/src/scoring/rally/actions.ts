export type RallyAction =
  { kind: "start_rubber"; rubberNo: number; gameNo: number } | { kind: "record_rally" };
