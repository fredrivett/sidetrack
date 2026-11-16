import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { CSSProperties, ReactNode } from "react";
import { __iconNode as calendarDays } from "lucide-react/dist/esm/icons/calendar-days.mjs";
import { __iconNode as chevronDown } from "lucide-react/dist/esm/icons/chevron-down.mjs";
import { __iconNode as listChecks } from "lucide-react/dist/esm/icons/list-checks.mjs";
import { __iconNode as repeat } from "lucide-react/dist/esm/icons/repeat.mjs";
import { __iconNode as sparkles } from "lucide-react/dist/esm/icons/sparkles.mjs";
import { ImageResponse } from "next/og";

// The card link previews show for every page (Open Graph, and X, which falls
// back to og:image). Dark, like the site in dark mode: a preview can't follow
// the viewer's theme, since each platform fetches one image and shows it to
// everyone. It restates the landing page: the logo, its headline and a list
// from the sample board, with an agent on one sub-item and a person on the
// next. Rendered once at build.
//
// The list is drawn in the board's own styles (ItemRow, DueBadge, RepeatBadge,
// LabelBadge, AgentAvatar, ItemList's tree lines) at 1.6× and in their dark
// colours. The components themselves can't render here: ImageResponse takes
// inline styles, not Tailwind classes, and they need the browser's day.

export const alt =
  "Sidetrack: the home for everything you get sidetracked by. A House chores list, where Claude is emailing roofers on one sub-item and Fred has the next.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

// Files read while rendering: the app's font, from the geist package
// (next/font only serves woff2, which ImageResponse can't read), and Fred's
// avatar. Only at build, so Turbopack needn't trace them into the server.
const asset = (path: string) =>
  readFile(join(/* turbopackIgnore: true */ process.cwd(), path));
const font = (file: string) => asset(`node_modules/geist/dist/fonts/${file}`);

/**
 * An emoji as Apple draws it, as a data URL, downloaded at build from the
 * emoji-datasource-apple package. Apple's artwork, so it's fetched rather than
 * kept in this AGPL repo, by choice: ImageResponse's own sets (Twemoji, Noto,
 * …) don't look like what most people see.
 */
async function appleEmoji(emoji: string): Promise<string> {
  const code = Array.from(emoji, (c) => (c.codePointAt(0) ?? 0).toString(16))
    .filter((c) => c !== "fe0f")
    .join("-");
  const res = await fetch(
    `https://cdn.jsdelivr.net/npm/emoji-datasource-apple@16.0.0/img/apple/64/${code}.png`,
  );
  if (!res.ok) throw new Error(`No Apple emoji for ${emoji}: ${res.status}`);
  return `data:image/png;base64,${Buffer.from(await res.arrayBuffer()).toString("base64")}`;
}

// The dark palette (Tailwind's neutral scale).
const C = {
  bg: "#0a0a0a",
  text: "#f5f5f5",
  muted: "#a3a3a3",
  faint: "#737373",
  card: "#171717",
  border: "#262626",
  badge: "#262626",
  tree: "#404040",
  checkbox: "#525252",
};

// The board at 1.6× its size.
const ROW_PAD = 13;
const CHECKBOX = 26;
const LINE = 32;
const AVATAR = 32;
const GAP = 10;

export default async function Image() {
  const [regular, medium, semibold, mono, fred, house, roof] = await Promise.all([
    font("geist-sans/Geist-Regular.ttf"),
    font("geist-sans/Geist-Medium.ttf"),
    font("geist-sans/Geist-SemiBold.ttf"),
    font("geist-mono/GeistMono-Regular.ttf"),
    asset("src/app/_og/fredrivett.jpg"),
    appleEmoji("🏡"),
    appleEmoji("🏠"),
  ]);
  const fredSrc = `data:image/jpeg;base64,${fred.toString("base64")}`;
  const FRED = <Person src={fredSrc} />;
  const AMP = <Agent />;

  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        position: "relative",
        background: C.bg,
        color: C.text,
        fontFamily: "Geist",
      }}
    >
      {/* The landing page's dot grid, fading out away from the top left. */}
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          width: "100%",
          height: "100%",
          // Satori draws gradient stops in percentages, not pixels.
          backgroundImage: "radial-gradient(#262626 9%, transparent 11%)",
          backgroundSize: "24px 24px",
          maskImage: "linear-gradient(160deg, white 10%, transparent 75%)",
        }}
      />

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "72px 0 72px 80px",
          width: 690,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 22 }}>
          <AppIcon size={76} />
          <span style={{ fontSize: 48, fontWeight: 600, letterSpacing: -1.2 }}>
            Sidetrack
          </span>
        </div>
        <div style={{ display: "flex", flexDirection: "column" }}>
          <Words
            size={17}
            style={{ fontWeight: 500, letterSpacing: 3.4, color: C.muted, marginBottom: 22 }}
          >
            OPEN SOURCE · SELF-HOSTABLE · AGENT NATIVE
          </Words>
          <Words size={64} style={{ fontWeight: 600, lineHeight: 1.04, letterSpacing: -2.6 }}>
            The home for everything you get sidetracked by.
          </Words>
          <Words
            size={27}
            style={{ color: C.muted, marginTop: 26, lineHeight: 1.35, maxWidth: 540 }}
          >
            Every project, every person, every agent. One board for all of it.
          </Words>
        </div>
      </div>

      {/* A list in its space's tray, tilted, running off the card's edges. */}
      <div
        style={{
          position: "absolute",
          left: 700,
          top: 34,
          width: 500,
          display: "flex",
          padding: 15,
          borderRadius: 33,
          background: "#0c1f13",
          border: "1.5px solid #14532d",
          boxShadow: "0 30px 60px -20px rgba(0,0,0,0.6)",
          transform: "rotate(-2deg)",
        }}
      >
        {/* ColumnCard */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: GAP,
            width: "100%",
            padding: "13px 19px 19px",
            borderRadius: 26,
            background: C.card,
            border: `1.5px solid ${C.border}`,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "2px 8px 4px" }}>
            <Emoji src={house} size={32} />
            <Words size={26} style={{ fontWeight: 600, letterSpacing: -0.4 }}>
              House chores
            </Words>
            <span
              style={{
                fontFamily: "Geist Mono",
                fontSize: 16,
                letterSpacing: 1,
                color: C.muted,
                background: C.badge,
                borderRadius: 6,
                padding: "2px 9px",
              }}
            >
              CHO
            </span>
          </div>

          <Row
            title="Water the plants"
            badges={
              <>
                <Badge icon={<Icon node={calendarDays} size={19} />}>This weekend</Badge>
                <Badge icon={<Icon node={repeat} size={19} />}>Every week</Badge>
              </>
            }
            avatars={[FRED]}
          />
          <Row
            title="Get three quotes for the roof"
            badges={
              <>
                <Badge icon={<Icon node={calendarDays} size={19} />}>Next week</Badge>
                <Label emoji={roof}>Roof</Label>
              </>
            }
            checklist="0/2"
            avatars={[AMP, FRED]}
          />
          <SubItem>
            <Row title="Email the roofers" avatars={[AMP]} />
          </SubItem>
          <SubItem last>
            <Row title="Pick the best quote" avatars={[FRED]} />
          </SubItem>
        </div>
      </div>

      {/* What the agent last reported, as on the landing page. */}
      <Note />
    </div>,
    {
      ...size,
      fonts: [
        { name: "Geist", data: regular, weight: 400, style: "normal" },
        { name: "Geist", data: medium, weight: 500, style: "normal" },
        { name: "Geist", data: semibold, weight: 600, style: "normal" },
        { name: "Geist Mono", data: mono, weight: 400, style: "normal" },
      ],
    },
  );
}

/**
 * Text set letter by letter. Satori lays text out by each letter's own width
 * but draws a run with Geist's kerning, which pulls it in and leaves a gap
 * after every word (wide after "everything", "sidetracked"). One box per
 * letter keeps the drawing where the layout put it; words wrap whole, a
 * space's width (0.236em in Geist) apart.
 */
function Words({
  size,
  style,
  children,
}: {
  size: number;
  style?: CSSProperties;
  children: string;
}) {
  const letterSpacing = Number(style?.letterSpacing ?? 0);
  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        fontSize: size,
        columnGap: size * 0.236 + letterSpacing,
        ...style,
      }}
    >
      {children.split(/\s+/).map((word, i) => (
        <div key={i} style={{ display: "flex" }}>
          {Array.from(word, (letter, j) => (
            <span key={j}>{letter}</span>
          ))}
        </div>
      ))}
    </div>
  );
}

/**
 * A lucide icon, the same one the board uses, drawn from its shapes:
 * lucide-react's components are client components, which can't run here.
 */
function Icon({
  node,
  size,
  color = "currentColor",
  style,
}: {
  node: [string, Record<string, string>][];
  size: number;
  color?: string;
  style?: CSSProperties;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={style}
    >
      {node.map(([Tag, { key, ...attrs }]) => {
        const Shape = Tag as "path";
        return <Shape key={key} {...attrs} />;
      })}
    </svg>
  );
}

/** The agent's latest report, below the list: violet, the agents' colour, and live. */
function Note() {
  return (
    <div
      style={{
        position: "absolute",
        left: 770,
        top: 506,
        width: 410,
        display: "flex",
        flexDirection: "column",
        gap: 8,
        padding: "16px 20px",
        borderRadius: 18,
        transform: "rotate(2deg)",
        backgroundImage: "linear-gradient(135deg, #3b1d7a 0%, #1e1035 100%)",
        border: "1.5px solid #7c3aed",
        boxShadow: "0 24px 48px -12px rgba(0,0,0,0.8)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, color: "#ddd6fe" }}>
        <Icon node={sparkles} size={18} color="#c4b5fd" />
        <Words size={17} style={{ fontWeight: 500 }}>
          Claude · CHO-12
        </Words>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            marginLeft: "auto",
            padding: "2px 9px",
            borderRadius: 999,
            background: "rgba(34,197,94,0.15)",
            color: "#4ade80",
            fontWeight: 500,
          }}
        >
          <div style={{ width: 8, height: 8, borderRadius: 4, background: "#22c55e" }} />
          <Words size={14}>Working</Words>
        </div>
      </div>
      <Words size={20} style={{ lineHeight: 1.4, color: "#f5f3ff" }}>
        Two of the three roofers have quoted. Chasing the third now.
      </Words>
    </div>
  );
}

/** The app icon (scripts/icons/icon.svg) with its colours swapped, to stand out on the dark card. */
function AppIcon({ size }: { size: number }) {
  return (
    <div
      style={{
        display: "flex",
        borderRadius: size * 0.1875,
        boxShadow: "0 10px 24px -8px rgba(0,0,0,0.6)",
      }}
    >
      <svg viewBox="0 0 512 512" width={size} height={size}>
        <rect width="512" height="512" rx="96" fill="#fafafa" />
        <g fill="#0a0a0a">
          <rect x="144" y="96" width="256" height="48" rx="12" />
          <rect x="112" y="160" width="128" height="48" rx="12" />
          <rect x="128" y="224" width="256" height="48" rx="12" />
          <rect x="272" y="288" width="128" height="48" rx="12" />
          <rect x="112" y="352" width="256" height="48" rx="12" />
        </g>
      </svg>
    </div>
  );
}

/** ItemRow: checkbox, title over its badges, then checklist progress and avatars. */
function Row({
  title,
  badges,
  checklist,
  avatars,
}: {
  title: string;
  badges?: ReactNode;
  checklist?: string;
  avatars: ReactNode[];
}) {
  return (
    <div
      style={{
        display: "flex",
        flexGrow: 1,
        alignItems: "flex-start",
        gap: 13,
        padding: ROW_PAD,
        borderRadius: 13,
        border: `1.5px solid ${C.border}`,
        background: C.card,
      }}
    >
      <div
        style={{
          width: CHECKBOX,
          height: CHECKBOX,
          marginTop: (LINE - CHECKBOX) / 2,
          borderRadius: CHECKBOX / 2,
          border: `2.5px solid ${C.checkbox}`,
          flexShrink: 0,
        }}
      />
      <div style={{ display: "flex", flexDirection: "column", gap: 3, flexGrow: 1, flexShrink: 1 }}>
        <Words size={22} style={{ lineHeight: `${LINE}px` }}>
          {title}
        </Words>
        {badges && <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>{badges}</div>}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 6, height: LINE, flexShrink: 0 }}>
        {checklist && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 5,
              padding: "0 3px",
              color: C.muted,
              fontSize: 18,
              fontWeight: 500,
            }}
          >
            <Icon node={listChecks} size={22} />
            {checklist}
            {/* ChevronRight turned down, as the board shows an open checklist.
                Drawn as ChevronDown: Satori turns it about the wrong point. */}
            <Icon node={chevronDown} size={19} />
          </div>
        )}
        <Stack>{avatars}</Stack>
      </div>
    </div>
  );
}

/**
 * AvatarStack: each avatar ringed in the row's colour, overlapping the next.
 * Satori has no z-index, so they're drawn last to first (row-reverse): the
 * first, an agent when one is on it, lands on top, as on the board.
 */
function Stack({ children }: { children: ReactNode[] }) {
  return (
    <div style={{ display: "flex", flexDirection: "row-reverse" }}>
      {[...children].reverse().map((avatar, i) => (
        <div
          key={i}
          style={{
            display: "flex",
            padding: 3,
            margin: -3,
            marginLeft: i === children.length - 1 ? -3 : -3 - 6,
            borderRadius: 13,
            background: C.card,
          }}
        >
          {avatar}
        </div>
      ))}
    </div>
  );
}

function Person({ src }: { src: string }) {
  return <img src={src} alt="" width={AVATAR} height={AVATAR} style={{ borderRadius: AVATAR }} />;
}

/** AgentAvatar: a violet rounded square, its working dot on the bottom left. */
function Agent() {
  const dot = Math.round(AVATAR * 0.35);
  return (
    <div
      style={{
        position: "relative",
        width: AVATAR,
        height: AVATAR,
        borderRadius: 10,
        background: "#2e1065",
        color: "#c4b5fd",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Icon node={sparkles} size={AVATAR * 0.6} />
      <div
        style={{
          position: "absolute",
          left: -4,
          bottom: -4,
          width: dot + 6,
          height: dot + 6,
          borderRadius: dot,
          background: "#22c55e",
          border: `3px solid ${C.card}`,
        }}
      />
    </div>
  );
}

/** DueBadge and RepeatBadge: an icon and a word, medium weight. */
function Badge({ icon, children }: { icon: ReactNode; children: string }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        padding: "3px 10px",
        borderRadius: 6,
        background: C.badge,
        color: C.muted,
        fontWeight: 500,
      }}
    >
      {icon}
      <Words size={16}>{children}</Words>
    </div>
  );
}

/** An emoji image from appleEmoji. */
function Emoji({ src, size }: { src: string; size: number }) {
  return <img src={src} alt="" width={size} height={size} />;
}

/** LabelBadge: the label's emoji and name. */
function Label({ emoji, children }: { emoji: string; children: string }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        padding: "3px 10px",
        borderRadius: 6,
        background: C.badge,
        color: C.faint,
      }}
    >
      <Emoji src={emoji} size={17} />
      <Words size={16}>{children}</Words>
    </div>
  );
}

/**
 * ItemList's SubItem: indented under the parent's checkbox, with a tree line
 * bending into the row at its first line, and carrying on down to the next
 * sub-item unless it's the last.
 */
function SubItem({ last, children }: { last?: boolean; children: ReactNode }) {
  const center = ROW_PAD + 1.5 + LINE / 2;
  return (
    <div style={{ display: "flex", marginLeft: 26, paddingLeft: 32 }}>
      <div style={{ display: "flex", position: "relative", flexGrow: 1 }}>
        <div
          style={{
            position: "absolute",
            top: -GAP,
            left: -32,
            width: 32,
            height: GAP + center,
            borderLeft: `3px solid ${C.tree}`,
            borderBottom: `3px solid ${C.tree}`,
            borderBottomLeftRadius: 13,
          }}
        />
        {!last && (
          <div
            style={{
              position: "absolute",
              top: 0,
              bottom: -GAP,
              left: -32,
              borderLeft: `3px solid ${C.tree}`,
            }}
          />
        )}
        <div style={{ display: "flex", flexGrow: 1 }}>{children}</div>
      </div>
    </div>
  );
}
