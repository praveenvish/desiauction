import type { ResultPoster } from "@desiauction/core";
import { Frame, Header, Footer, contextFor, vis, type PosterRenderOptions } from "./poster-kit";
import { FIGURES } from "./poster-fonts";

/** A recorded wagon sits behind the verdict; no inferred or decorative deliveries. */
export function renderResultPoster(model: ResultPoster, options: PosterRenderOptions) {
  const ctx = contextFor(options, model.teams[0]?.color ?? null);
  const { palette } = ctx.skin;
  const { width, height, pad } = ctx.metrics;
  const wheel = width * 0.56;
  const center = wheel / 2;
  const pom = model.playerOfMatch;
  const compact = options.size === "square";
  return (
    <Frame ctx={ctx}>
      <div style={{ display: "flex", width: "100%", ...vis(ctx, "base") }}>
        <Header
          ctx={ctx}
          competitionName={model.competitionName}
          competitionLogoUrl={model.competitionLogoUrl}
          chip="RESULT"
        />
      </div>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          position: "relative",
          width: "100%",
          flexGrow: 1,
          marginTop: compact ? 36 : 72,
        }}
      >
        {pom && pom.shots.length > 0 ? (
          <svg
            width={wheel}
            height={wheel}
            viewBox={`0 0 ${String(wheel)} ${String(wheel)}`}
            style={{
              position: "absolute",
              right: -pad,
              top: 0,
              opacity: vis(ctx, "hero").opacity * 0.35,
            }}
          >
            <circle
              cx={center}
              cy={center}
              r={center - 2}
              fill={palette.panel}
              stroke={palette.border}
              strokeWidth={3}
            />
            {pom.shots.map((shot, index) => {
              const radians = ((shot.angle - 90) * Math.PI) / 180;
              const radius = center * (shot.runs >= 6 ? 0.94 : shot.runs >= 4 ? 0.81 : 0.59);
              return (
                <line
                  key={index}
                  x1={center}
                  y1={center}
                  x2={center + Math.cos(radians) * radius}
                  y2={center + Math.sin(radians) * radius}
                  stroke={shot.runs >= 6 ? palette.accent : palette.body}
                  strokeWidth={shot.runs >= 4 ? 4 : 2}
                />
              );
            })}
          </svg>
        ) : null}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            width: "100%",
            ...vis(ctx, "stamp"),
          }}
        >
          <div style={{ display: "flex", fontSize: 24, color: palette.muted }}>
            {model.fixtureLabel}
          </div>
          <div
            style={{
              display: "flex",
              maxWidth: "70%",
              fontSize: compact ? 100 : 140,
              fontWeight: 800,
              lineHeight: 1.05,
              marginTop: 20,
            }}
          >
            {model.headline.toUpperCase()}
          </div>
          <div style={{ display: "flex", fontSize: 32, color: palette.accent, marginTop: 26 }}>
            {model.margin}
          </div>
        </div>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            marginTop: 36,
            gap: 18,
            ...vis(ctx, "hero"),
          }}
        >
          {model.teams.map((team, index) => (
            <div
              key={index}
              style={{ display: "flex", alignItems: "center", gap: 18, width: "100%" }}
            >
              <div
                style={{
                  display: "flex",
                  width: 8,
                  height: 44,
                  background: team.color ?? palette.accent,
                }}
              />
              <div style={{ display: "flex", flexGrow: 1, fontSize: 32, fontWeight: 600 }}>
                {team.name}
              </div>
              <div style={{ display: "flex", fontFamily: FIGURES, fontSize: 36, fontWeight: 700 }}>
                {team.score}
              </div>
            </div>
          ))}
        </div>
        <div style={{ display: "flex", flexGrow: 1, minHeight: 24 }} />
        {pom ? (
          <div
            style={{
              display: "flex",
              gap: 24,
              width: "100%",
              border: `2px solid ${palette.accent}`,
              borderRadius: 24,
              padding: 24,
              background: palette.panel,
              ...vis(ctx, "items"),
            }}
          >
            {pom.photoUrl ? (
              <img
                src={pom.photoUrl}
                width={128}
                height={128}
                style={{ borderRadius: 18, objectFit: "cover" }}
                alt=""
              />
            ) : (
              <div
                style={{
                  display: "flex",
                  width: 128,
                  height: 128,
                  alignItems: "center",
                  justifyContent: "center",
                  background: palette.accent,
                  color: palette.onAccent,
                  borderRadius: 18,
                  fontSize: 48,
                }}
              >
                {pom.monogram}
              </div>
            )}
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                flexGrow: 1,
                justifyContent: "center",
                gap: 10,
              }}
            >
              <div style={{ display: "flex", fontSize: 20, color: palette.accent }}>
                PLAYER OF THE MATCH
              </div>
              <div style={{ display: "flex", fontSize: 44, fontWeight: 700 }}>{pom.name}</div>
              <div style={{ display: "flex", fontSize: 26, color: palette.body }}>
                {pom.figures}
              </div>
            </div>
          </div>
        ) : null}
        <div
          style={{
            display: "flex",
            fontSize: 22,
            color: palette.muted,
            marginTop: 20,
            marginBottom: height > 1350 ? 40 : 24,
            ...vis(ctx, "base"),
          }}
        >
          {model.trustLabel}
        </div>
      </div>
      <Footer ctx={ctx} />
    </Frame>
  );
}
