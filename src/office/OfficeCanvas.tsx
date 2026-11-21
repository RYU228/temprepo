import { useEffect, useRef, useState } from "react";
import type { Agent, AgentStatus, Department } from "../api";
import { STATUS_LABEL } from "../api";
import { computeLayout, LOBBY_H, meetingSpots, type Layout, type Room } from "./layout";

type Pt = { x: number; y: number };
type Sprite = {
  id: number;
  x: number;
  y: number;
  path: Pt[];
  deptId: number;
  anchorKey: string;
  wanderAt: number;
  walkT: number;
  facing: "up" | "down" | "left" | "right";
};

type Props = {
  departments: Department[];
  agents: Agent[];
  selectedAgentId: number | null;
  selectedDeptId: number | null;
  onSelectAgent: (id: number) => void;
  onSelectDept: (id: number) => void;
  onNewDept: () => void;
};

const SPEED = 3.2; // 타일/초
const FONT = `"Noto Sans KR", "Apple SD Gothic Neo", "Malgun Gothic", sans-serif`;

function shade(hex: string, amt: number) {
  const n = parseInt(hex.slice(1), 16);
  const f = (c: number) => Math.max(0, Math.min(255, Math.round(c + (amt > 0 ? (255 - c) * amt : c * amt))));
  const r = f(n >> 16), g = f((n >> 8) & 255), b = f(n & 255);
  return `rgb(${r},${g},${b})`;
}

export default function OfficeCanvas(props: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [width, setWidth] = useState(900);
  const propsRef = useRef(props);
  propsRef.current = props;
  const sprites = useRef(new Map<number, Sprite>());
  const layoutRef = useRef<Layout | null>(null);
  const hoverRef = useRef<{ agent: number | null; room: Room | null }>({ agent: null, room: null });

  const cols = width < 640 ? 1 : width < 1050 ? 2 : 3;
  const layout = computeLayout(props.departments, props.agents, cols);
  layoutRef.current = layout;
  const scale = width / layout.width;
  const heightPx = Math.ceil(layout.height * scale);

  useEffect(() => {
    const el = wrapRef.current!;
    const ro = new ResizeObserver(() => setWidth(Math.max(320, el.clientWidth)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // 렌더 루프
  useEffect(() => {
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext("2d")!;
    let raf = 0;
    let last = performance.now();

    const frame = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const L = layoutRef.current!;
      const { agents, departments } = propsRef.current;
      const dpr = window.devicePixelRatio || 1;
      const s = canvas.clientWidth / L.width;
      if (canvas.width !== Math.round(canvas.clientWidth * dpr)) canvas.width = Math.round(canvas.clientWidth * dpr);
      if (canvas.height !== Math.round(canvas.clientHeight * dpr)) canvas.height = Math.round(canvas.clientHeight * dpr);
      ctx.setTransform(dpr * s, 0, 0, dpr * s, 0, 0);
      ctx.imageSmoothingEnabled = false;

      updateSprites(L, agents, dt, now);
      drawWorld(ctx, L, departments, agents, now, s);
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, []);

  function anchorFor(L: Layout, a: Agent, now: number, sp: Sprite | undefined): { key: string; pt: Pt } | null {
    const desk = L.desks.get(a.id);
    const room = L.roomOf.get(a.department_id);
    if (!desk || !room) return null;
    if (a.status === "meeting") {
      const peers = propsRef.current.agents.filter((p) => p.department_id === a.department_id && p.status === "meeting");
      const idx = peers.findIndex((p) => p.id === a.id);
      return { key: `meet-${idx}`, pt: meetingSpots(room, peers.length)[idx] };
    }
    if (a.status !== "idle") return { key: "seat", pt: desk.seat };
    // 대기 상태: 자리에 있다가 가끔 돌아다님
    if (sp && sp.path.length === 0 && now > sp.wanderAt) {
      sp.wanderAt = now + 4000 + Math.random() * 9000;
      if (Math.random() < 0.45) {
        const pt = {
          x: room.x + 1.2 + Math.random() * (room.w - 2.4),
          y: room.y + room.h - 1.0 - Math.random() * 0.6,
        };
        return { key: `wander-${now}`, pt };
      }
      return { key: "seat", pt: desk.seat };
    }
    return sp ? { key: sp.anchorKey, pt: sp.path.at(-1) ?? { x: sp.x, y: sp.y } } : { key: "seat", pt: desk.seat };
  }

  function updateSprites(L: Layout, agents: Agent[], dt: number, now: number) {
    const map = sprites.current;
    const alive = new Set(agents.map((a) => a.id));
    for (const id of map.keys()) if (!alive.has(id)) map.delete(id);
    const firstLoad = map.size === 0;

    for (const a of agents) {
      const desk = L.desks.get(a.id);
      const room = L.roomOf.get(a.department_id);
      if (!desk || !room) continue;
      let sp = map.get(a.id);
      if (!sp) {
        // 처음 로드면 자리에서 시작, 새로 채용된 직원은 로비에서 걸어 들어옴
        const start = firstLoad ? desk.seat : L.lobbySpawn;
        sp = {
          id: a.id, x: start.x, y: start.y, path: [], deptId: a.department_id,
          anchorKey: "seat", wanderAt: now + Math.random() * 6000, walkT: 0, facing: "down",
        };
        if (!firstLoad) sp.path = route(L, null, room, desk.seat);
        map.set(a.id, sp);
      }

      // 부서 이동: 문 → 복도 → 새 방 문 → 자리
      if (sp.deptId !== a.department_id) {
        const oldRoom = [...L.rooms].find((r) => r.x <= sp!.x && sp!.x <= r.x + r.w && r.y <= sp!.y && sp!.y <= r.y + r.h);
        sp.path = route(L, oldRoom ?? null, room, desk.seat);
        sp.deptId = a.department_id;
        sp.anchorKey = "seat";
      } else {
        const anc = anchorFor(L, a, now, sp);
        if (anc && (anc.key !== sp.anchorKey || (anc.key === "seat" && sp.path.length === 0 && dist(sp, anc.pt) > 0.05))) {
          sp.anchorKey = anc.key;
          sp.path = [anc.pt];
        }
      }

      // 이동
      if (sp.path.length) {
        const t = sp.path[0];
        const dx = t.x - sp.x, dy = t.y - sp.y;
        const d = Math.hypot(dx, dy);
        const step = SPEED * dt;
        if (d <= step) {
          sp.x = t.x; sp.y = t.y; sp.path.shift();
        } else {
          sp.x += (dx / d) * step; sp.y += (dy / d) * step;
          sp.facing = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "right" : "left") : dy > 0 ? "down" : "up";
        }
        sp.walkT += dt;
      } else {
        sp.walkT = 0;
        const atSeat = dist(sp, desk.seat) < 0.05;
        sp.facing = atSeat ? "up" : "down";
      }
    }
  }

  function drawWorld(ctx: CanvasRenderingContext2D, L: Layout, departments: Department[], agents: Agent[], now: number, s: number) {
    const { selectedAgentId, selectedDeptId } = propsRef.current;
    const hover = hoverRef.current;
    const R = (x: number, y: number, w: number, h: number, c: string) => {
      ctx.fillStyle = c;
      ctx.fillRect(x, y, w, h);
    };
    const px = 1 / 16; // 픽셀 하나(타일의 1/16)

    // 복도 바닥
    for (let y = 0; y < L.height; y++)
      for (let x = 0; x < L.width; x++) R(x, y, 1, 1, (x + y) % 2 ? "#d9d4c7" : "#e2ddd1");

    // 로비
    R(0, 0, L.width, LOBBY_H, "#cfc6b3");
    for (let x = 0; x < L.width; x += 1) R(x, 0, 1, 0.5, x % 2 ? "#5d4e3c" : "#665643");
    R(L.width / 2 - 2, 0, 4, 0.5, "#9fd3e8"); // 출입문 유리
    R(L.width / 2 - 2, 0.45, 4, 0.08, "#4a7b8f");
    // 리셉션 데스크 + 간판
    const cx = L.width / 2;
    R(cx - 3.5, 1.4, 7, 1.1, "#7a5a3a");
    R(cx - 3.5, 1.4, 7, 0.2, "#a07a50");
    text(ctx, "AI OFFICE", cx, 2.15, 0.55, "#fff7e6", "center", 800);
    plant(ctx, 1.2, 1.2);
    plant(ctx, L.width - 2.2, 1.2);

    // 방
    for (const room of L.rooms) {
      const d = room.dept;
      if (!d) {
        drawEmptyRoom(ctx, room, hover.room === room);
        continue;
      }
      const base = d.color;
      // 바닥(카펫)
      for (let y = 0; y < room.h; y++)
        for (let x = 0; x < room.w; x++)
          R(room.x + x, room.y + y, 1, 1, (x + y) % 2 ? shade(base, 0.72) : shade(base, 0.66));
      // 벽
      const wall = "#4b4038";
      R(room.x - 0.25, room.y - 0.25, room.w + 0.5, 1.1, wall);
      R(room.x - 0.25, room.y + 0.75, room.w + 0.5, 0.1, shade(base, -0.2));
      R(room.x - 0.25, room.y - 0.25, 0.35, room.h + 0.5, wall);
      R(room.x + room.w - 0.1, room.y - 0.25, 0.35, room.h + 0.5, wall);
      R(room.x - 0.25, room.y + room.h - 0.1, room.w / 2 - 1.2, 0.35, wall);
      R(room.x + room.w / 2 + 1.45, room.y + room.h - 0.1, room.w / 2 - 1.2, 0.35, wall);
      // 간판
      ctx.font = `700 0.55px ${FONT}`;
      const tw = ctx.measureText(d.name).width + 0.8;
      R(room.x + 0.5, room.y + 0.05, tw, 0.65, base);
      R(room.x + 0.5, room.y + 0.62, tw, 0.08, shade(base, -0.3));
      text(ctx, d.name, room.x + 0.9, room.y + 0.58, 0.5, "#fff", "left", 700);
      // 회의 테이블
      const tx = room.x + room.w / 2, ty = room.y + room.h - 1.6;
      R(tx - 2, ty - 0.35, 4, 0.75, "#8a6a48");
      R(tx - 2, ty - 0.35, 4, 0.15, "#a8845c");
      R(tx - 0.6, ty - 0.25, 0.5, 0.35, "#f4f1e8");
      R(tx + 0.3, ty - 0.2, 0.25, 0.25, "#e8d0a0");
      plant(ctx, room.x + room.w - 1.3, room.y + 1);
      // 선택/호버 테두리
      if (selectedDeptId === d.id || hover.room === room) {
        ctx.strokeStyle = selectedDeptId === d.id ? "#ffd166" : "rgba(255,255,255,0.7)";
        ctx.lineWidth = selectedDeptId === d.id ? 0.18 : 0.1;
        ctx.strokeRect(room.x - 0.35, room.y - 0.35, room.w + 0.7, room.h + 0.7);
      }
    }

    // 책상 (사람보다 먼저)
    const byId = new Map(agents.map((a) => [a.id, a]));
    for (const [agentId, desk] of L.desks) {
      const a = byId.get(agentId)!;
      const w = desk.lead ? 2.6 : 2;
      R(desk.x - w / 2, desk.y - 0.45, w, 0.9, desk.lead ? "#6b4a2e" : "#9a7650");
      R(desk.x - w / 2, desk.y - 0.45, w, 0.15, desk.lead ? "#8a6240" : "#b8956a");
      R(desk.x - w / 2 + 0.1, desk.y + 0.45, 0.15, 0.3, "#5a4430");
      R(desk.x + w / 2 - 0.25, desk.y + 0.45, 0.15, 0.3, "#5a4430");
      // 모니터
      R(desk.x - 0.5, desk.y - 0.95, 1, 0.65, "#2b2b33");
      const on = !!a && ["working", "thinking", "waiting"].includes(a.status);
      const flicker = on ? 0.15 * Math.sin(now / 90 + agentId) : 0;
      R(desk.x - 0.42, desk.y - 0.88, 0.84, 0.48, on ? shade("#4fc3f7", flicker) : "#3d4a5c");
      if (a?.status === "working") {
        for (let i = 0; i < 3; i++) {
          const lw = 0.2 + ((Math.floor(now / 200) + i * 7 + agentId) % 5) * 0.1;
          R(desk.x - 0.35, desk.y - 0.8 + i * 0.13, lw, 0.06, "#e1f5fe");
        }
      }
      R(desk.x - 0.1, desk.y - 0.32, 0.2, 0.12, "#2b2b33");
      // 키보드, 컵
      R(desk.x - 0.4, desk.y - 0.12, 0.8, 0.18, "#d8d8d8");
      R(desk.x + w / 2 - 0.45, desk.y - 0.25, 0.22, 0.25, "#f4f1e8");
      if (desk.lead) R(desk.x - w / 2 + 0.2, desk.y - 0.3, 0.45, 0.35, "#e8c547");
      // 의자
      R(desk.seat.x - 0.4, desk.seat.y - 0.35, 0.8, 0.5, "#3a3a44");
    }

    // 사람: y 순서대로
    const list = agents
      .map((a) => ({ a, sp: sprites.current.get(a.id) }))
      .filter((v): v is { a: Agent; sp: Sprite } => !!v.sp)
      .sort((p, q) => p.sp.y - q.sp.y);
    for (const { a, sp } of list) {
      const walking = sp.path.length > 0;
      const bob = walking ? Math.abs(Math.sin(sp.walkT * 10)) * 0.06 : a.status === "working" ? Math.abs(Math.sin(now / 120)) * 0.03 : 0;
      const x = sp.x, y = sp.y - bob;
      // 그림자
      ctx.fillStyle = "rgba(0,0,0,0.2)";
      ctx.beginPath();
      ctx.ellipse(sp.x, sp.y, 0.38, 0.14, 0, 0, Math.PI * 2);
      ctx.fill();
      if (a.id === selectedAgentId || hover.agent === a.id) {
        ctx.strokeStyle = a.id === selectedAgentId ? "#ffd166" : "rgba(255,255,255,0.8)";
        ctx.lineWidth = 0.08;
        ctx.beginPath();
        ctx.ellipse(sp.x, sp.y, 0.5, 0.2, 0, 0, Math.PI * 2);
        ctx.stroke();
      }
      // 다리
      const leg = walking ? Math.sin(sp.walkT * 12) * 2 * px : 0;
      R(x - 4 * px, y - 4 * px + leg, 3 * px, 4 * px, "#2d3142");
      R(x + 1 * px, y - 4 * px - leg, 3 * px, 4 * px, "#2d3142");
      // 몸통
      R(x - 5 * px, y - 12 * px, 10 * px, 8 * px, a.color);
      R(x - 5 * px, y - 12 * px, 10 * px, 2 * px, shade(a.color, 0.2));
      R(x - 6 * px, y - 11 * px, 1 * px, 6 * px, shade(a.color, -0.15));
      R(x + 5 * px, y - 11 * px, 1 * px, 6 * px, shade(a.color, -0.15));
      if (a.is_lead) R(x - 1 * px, y - 12 * px, 2 * px, 5 * px, "#ffd166"); // 넥타이
      // 머리
      R(x - 4 * px, y - 20 * px, 8 * px, 8 * px, "#f1c27d");
      const hair = shade(a.color, -0.55);
      if (sp.facing === "up") {
        R(x - 4 * px, y - 21 * px, 8 * px, 8 * px, hair);
      } else {
        R(x - 4 * px, y - 21 * px, 8 * px, 3 * px, hair);
        R(x - 4 * px, y - 19 * px, 1 * px, 3 * px, hair);
        R(x + 3 * px, y - 19 * px, 1 * px, 3 * px, hair);
        const blink = Math.floor(now / 100 + a.id * 13) % 40 === 0;
        if (!blink) {
          const ex = sp.facing === "left" ? -1 : sp.facing === "right" ? 1 : 0;
          R(x + (-2 + ex) * px, y - 16 * px, 1 * px, 2 * px, "#222");
          R(x + (1 + ex) * px, y - 16 * px, 1 * px, 2 * px, "#222");
        }
      }
      // 이름표
      ctx.font = `600 0.36px ${FONT}`;
      const label = a.name;
      const lw = ctx.measureText(label).width + 0.3;
      ctx.fillStyle = "rgba(20,20,28,0.72)";
      roundRect(ctx, sp.x - lw / 2, sp.y + 0.12, lw, 0.46, 0.12);
      ctx.fill();
      text(ctx, label, sp.x, sp.y + 0.48, 0.36, "#fff", "center", 600);
      // 말풍선
      if (a.status !== "idle") bubble(ctx, sp.x, y - 1.45, a.status, now);
    }
    void s;
  }

  function drawEmptyRoom(ctx: CanvasRenderingContext2D, room: Room, hovered: boolean) {
    ctx.save();
    ctx.setLineDash([0.4, 0.3]);
    ctx.strokeStyle = hovered ? "#555" : "#9a9384";
    ctx.lineWidth = 0.12;
    ctx.strokeRect(room.x, room.y, room.w, room.h);
    ctx.restore();
    if (hovered) {
      ctx.fillStyle = "rgba(255,255,255,0.35)";
      ctx.fillRect(room.x, room.y, room.w, room.h);
    }
    text(ctx, "+", room.x + room.w / 2, room.y + room.h / 2 - 0.2, 2, "#8a8374", "center", 300);
    text(ctx, "새 부서 만들기", room.x + room.w / 2, room.y + room.h / 2 + 1.3, 0.6, "#6f6859", "center", 600);
  }

  // 클릭/호버
  function hit(e: React.MouseEvent) {
    const L = layoutRef.current!;
    const rect = canvasRef.current!.getBoundingClientRect();
    const s = rect.width / L.width;
    const x = (e.clientX - rect.left) / s, y = (e.clientY - rect.top) / s;
    let agent: number | null = null;
    let best = Infinity;
    for (const sp of sprites.current.values()) {
      if (Math.abs(x - sp.x) < 0.5 && y < sp.y + 0.6 && y > sp.y - 1.4) {
        const d = Math.abs(y - (sp.y - 0.6));
        if (d < best) { best = d; agent = sp.id; }
      }
    }
    const room = L.rooms.find((r) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) ?? null;
    return { agent, room };
  }

  return (
    <div ref={wrapRef} className="office-wrap">
      <canvas
        ref={canvasRef}
        style={{ width: "100%", height: heightPx, display: "block", cursor: "default" }}
        onMouseMove={(e) => {
          const h = hit(e);
          hoverRef.current = h;
          (e.target as HTMLCanvasElement).style.cursor = h.agent || h.room ? "pointer" : "default";
        }}
        onMouseLeave={() => (hoverRef.current = { agent: null, room: null })}
        onClick={(e) => {
          const h = hit(e);
          if (h.agent) props.onSelectAgent(h.agent);
          else if (h.room?.dept) props.onSelectDept(h.room.dept.id);
          else if (h.room) props.onNewDept();
        }}
      />
    </div>
  );
}

/** 벽을 뚫지 않도록 복도를 따라가는 경로: (이전 방 문 →) 위쪽 복도 → 방 왼쪽 세로 복도 → 문 → 자리 */
function route(L: Layout, from: Room | null, to: Room, seat: Pt): Pt[] {
  const topY = LOBBY_H + 0.9;
  const pts: Pt[] = [];
  if (from) {
    pts.push({ x: from.door.x, y: from.y + from.h - 1 }, from.door, { x: from.x - 1, y: from.door.y }, { x: from.x - 1, y: topY });
  } else {
    pts.push({ x: L.lobbySpawn.x, y: topY });
  }
  pts.push({ x: to.x - 1, y: topY }, { x: to.x - 1, y: to.door.y }, to.door, { x: to.door.x, y: to.y + to.h - 1 }, seat);
  return pts;
}

function dist(a: Pt, b: Pt) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function text(ctx: CanvasRenderingContext2D, s: string, x: number, y: number, size: number, color: string, align: CanvasTextAlign, weight = 400) {
  ctx.font = `${weight} ${size}px ${FONT}`;
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.textBaseline = "alphabetic";
  ctx.fillText(s, x, y);
  ctx.textAlign = "left";
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

function plant(ctx: CanvasRenderingContext2D, x: number, y: number) {
  ctx.fillStyle = "#b5651d";
  ctx.fillRect(x + 0.25, y + 0.5, 0.5, 0.45);
  ctx.fillStyle = "#3f8f3f";
  ctx.fillRect(x + 0.1, y, 0.8, 0.55);
  ctx.fillStyle = "#5cb85c";
  ctx.fillRect(x + 0.25, y - 0.2, 0.5, 0.35);
}

const BUBBLE_COLOR: Record<AgentStatus, string> = {
  idle: "#fff",
  thinking: "#fff3c4",
  working: "#d7f0ff",
  waiting: "#eee",
  meeting: "#e3f7d9",
};

function bubble(ctx: CanvasRenderingContext2D, x: number, y: number, status: AgentStatus, now: number) {
  const dots = ".".repeat(1 + (Math.floor(now / 400) % 3));
  const label = STATUS_LABEL[status] + (status === "working" || status === "thinking" ? dots : "");
  ctx.font = `600 0.34px ${FONT}`;
  const w = Math.max(1.3, ctx.measureText(STATUS_LABEL[status] + "...").width + 0.35);
  const h = 0.5;
  ctx.fillStyle = BUBBLE_COLOR[status];
  ctx.strokeStyle = "rgba(0,0,0,0.45)";
  ctx.lineWidth = 0.05;
  roundRect(ctx, x - w / 2, y - h, w, h, 0.15);
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x - 0.12, y);
  ctx.lineTo(x, y + 0.15);
  ctx.lineTo(x + 0.12, y);
  ctx.fill();
  ctx.fillStyle = "#222";
  ctx.textAlign = "left";
  ctx.fillText(label, x - w / 2 + 0.18, y - 0.14);
}
