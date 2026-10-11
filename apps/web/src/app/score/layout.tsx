import "@desiauction/ui/styles/fonts.css";
import type { ReactNode } from "react";
import { headers } from "next/headers";
import { THEME_BOOTSTRAP } from "../../components/shell/theme-bootstrap";
import "./score.css";

const SCORING_THEME = `try{var t=localStorage.getItem('ls1:theme');if(t==='daylight'||t==='floodlight'){document.documentElement.setAttribute('data-theme',t)}else if(t==='auto'){document.documentElement.setAttribute('data-theme',matchMedia('(prefers-color-scheme: dark)').matches?'floodlight':'daylight')}else{${THEME_BOOTSTRAP}}}catch(e){}`;
export default async function ScoreLayout({ children }: { children: ReactNode }) {
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  return (
    <div className="score-app">
      <script
        nonce={nonce}
        suppressHydrationWarning
        dangerouslySetInnerHTML={{ __html: SCORING_THEME }}
      />
      {children}
    </div>
  );
}
