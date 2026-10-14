import type { MatchState } from "./state";
import type { NameBook, PublicScorecard } from "../types";
import { BOWLER_WICKETS } from "./wickets";
import { oversText } from "./public-state";
/** Complete tables from this fold only; the NameBook has already applied public privacy. */
export function publicScorecard(state: MatchState, names: NameBook): PublicScorecard {
  const identity = (id: string) => {
    const name = names.players[id];
    return { id, name: name?.name ?? id, initials: name?.initials ?? id.slice(0, 2).toUpperCase() };
  };
  const perOver = state.format?.ballsPerOver ?? 6;
  return {
    v: 1,
    seq: state.lastSeq,
    ballsPerOver: perOver,
    innings: state.innings.map((innings) => ({
      battingTeamId: innings.battingTeamId,
      superOver: innings.superOver,
      batting: innings.battedOrder.flatMap((id) => {
        const line = innings.batters[id];
        const delivery =
          !line?.notOut && line?.howOut
            ? innings.overs
                .flatMap((over) => over.balls)
                .reverse()
                .find((ball) => ball.wicket?.playerOutId === id && ball.wicket.kind === line.howOut)
            : undefined;
        const wicket = delivery?.wicket;
        return line
          ? [
              {
                ...identity(id),
                runs: line.runs,
                balls: line.balls,
                fours: line.fours,
                sixes: line.sixes,
                dismissal: line.howOut,
                ...(delivery && wicket
                  ? {
                      attribution: {
                        bowler: BOWLER_WICKETS.includes(wicket.kind)
                          ? identity(delivery.bowlerId)
                          : null,
                        fielders: wicket.fielderIds.map((fielderId) => ({
                          ...identity(fielderId),
                          substitute: wicket.substituteFielderIds?.includes(fielderId) ?? false,
                        })),
                        unknownFielders: wicket.unknownFielderCount ?? 0,
                      },
                    }
                  : {}),
                notOut: line.notOut,
                retiredHurt: line.retiredHurt,
              },
            ]
          : [];
      }),
      bowling: [
        ...new Set([
          ...innings.overs.flatMap((over) => over.balls.map((ball) => ball.bowlerId)),
          ...Object.keys(innings.bowlers),
        ]),
      ].flatMap((id) => {
        const line = innings.bowlers[id];
        return line
          ? [
              {
                ...identity(id),
                legalBalls: line.legalBalls,
                overs: oversText(line.legalBalls, perOver),
                maidens: line.maiden,
                runs: line.runs,
                wickets: line.wickets,
                wides: line.wides,
                noBalls: line.noBalls,
              },
            ]
          : [];
      }),
      extras: { ...innings.extras },
    })),
  };
}
