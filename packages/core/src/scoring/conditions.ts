export interface Conditions {
  timeOfDay?: "day" | "day_night" | "night";
  ball?: { type: "leather" | "tennis" | "tape" | "rubber"; colour?: "red" | "white" | "pink" };
  ground?: "full" | "half" | "box" | "indoor";
  pitch?: "turf" | "matting" | "astroturf" | "cement";
}

export interface ConditionsGround {
  indoor: boolean;
  floodlights: boolean;
  surface: "turf" | "matting" | "astroturf" | "concrete" | "other";
}

/** The caller supplies local wall-clock time, never a timezone-dependent Date. */
export function defaultConditions(
  ground: ConditionsGround | null,
  kickoffLocalTime: string | null,
  seasonRules: { ball?: Conditions["ball"] },
): Conditions {
  const time = /^(\d{2}):([0-5]\d)(?::[0-5]\d)?$/.exec(kickoffLocalTime ?? "");
  const hour = time ? Number(time[1]) : 0;
  const conditions: Conditions = {
    timeOfDay:
      hour >= 18 && hour <= 23
        ? "night"
        : hour >= 15 && hour <= 23 && ground?.floodlights
          ? "day_night"
          : "day",
    ground: ground?.indoor ? "indoor" : "full",
  };
  if (seasonRules.ball) conditions.ball = { ...seasonRules.ball };
  if (ground?.surface === "concrete") conditions.pitch = "cement";
  else if (ground && ground.surface !== "other") conditions.pitch = ground.surface;
  return conditions;
}

export function conditionsLine(conditions: Conditions): string {
  const time = { day: "Day", day_night: "Day–night", night: "Night" };
  const ball = conditions.ball;
  const ballLabel =
    ball?.type === "leather"
      ? [ball.colour, "leather"].filter(Boolean).join(" ")
      : ball
        ? { tennis: "Tennis", tape: "Tape", rubber: "Rubber" }[ball.type]
        : undefined;
  return [conditions.timeOfDay && time[conditions.timeOfDay], ballLabel, conditions.pitch]
    .filter(Boolean)
    .join(" · ");
}
