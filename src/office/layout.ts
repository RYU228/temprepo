import type { Agent, Department } from "../api";

/** 모든 좌표는 타일 단위 */
export const ROOM_W = 14;
export const ROOM_H = 11;
export const GAP = 2; // 방 사이 복도 폭
export const LOBBY_H = 4;

export type Room = {
  dept: Department | null; // null 이면 "새 부서" 빈 방
  x: number;
  y: number;
  w: number;
  h: number;
  door: { x: number; y: number }; // 방 아래쪽 문(복도 쪽)
};

export type Desk = { x: number; y: number; seat: { x: number; y: number }; lead: boolean };

export type Layout = {
  cols: number;
  width: number;
  height: number;
  rooms: Room[];
  desks: Map<number, Desk>; // agentId -> 책상
  roomOf: Map<number, Room>; // deptId -> 방
  lobbySpawn: { x: number; y: number };
};

// 방 안의 책상 슬롯 (방 좌상단 기준). 0번은 팀장 자리
const SLOTS: { x: number; y: number }[] = [
  { x: 7, y: 1.7 },
  { x: 1.5, y: 4 },
  { x: 4.5, y: 4 },
  { x: 8.5, y: 4 },
  { x: 11.5, y: 4 },
  { x: 1.5, y: 6.8 },
  { x: 4.5, y: 6.8 },
  { x: 8.5, y: 6.8 },
  { x: 11.5, y: 6.8 },
];

export function meetingSpots(room: Room, n: number) {
  // 방 아래쪽 회의 테이블 주위
  const cx = room.x + room.w / 2;
  const cy = room.y + room.h - 1.6;
  return Array.from({ length: n }, (_, i) => {
    const side = i % 2 === 0 ? -1 : 1;
    const k = Math.floor(i / 2);
    return { x: cx + side * (1.2 + k * 0.9), y: cy + (k % 2 ? 0.25 : -0.1) };
  });
}

export function computeLayout(departments: Department[], agents: Agent[], cols: number): Layout {
  const slots = [...departments.map((d) => d as Department | null), null];
  const rows = Math.ceil(slots.length / cols);
  const width = cols * ROOM_W + (cols + 1) * GAP;
  const height = LOBBY_H + rows * ROOM_H + (rows + 1) * GAP;

  const rooms: Room[] = slots.map((dept, i) => {
    const c = i % cols;
    const r = Math.floor(i / cols);
    const x = GAP + c * (ROOM_W + GAP);
    const y = LOBBY_H + GAP + r * (ROOM_H + GAP);
    return { dept, x, y, w: ROOM_W, h: ROOM_H, door: { x: x + ROOM_W / 2, y: y + ROOM_H + 0.8 } };
  });

  const roomOf = new Map<number, Room>();
  for (const r of rooms) if (r.dept) roomOf.set(r.dept.id, r);

  const desks = new Map<number, Desk>();
  for (const dept of departments) {
    const room = roomOf.get(dept.id)!;
    const members = agents
      .filter((a) => a.department_id === dept.id)
      .sort((a, b) => b.is_lead - a.is_lead || a.id - b.id);
    const hasLead = members.some((m) => m.is_lead);
    members.forEach((a, i) => {
      const slot = SLOTS[hasLead ? i : i + 1] ?? SLOTS[SLOTS.length - 1];
      const x = room.x + slot.x;
      const y = room.y + slot.y;
      desks.set(a.id, { x, y, seat: { x, y: y + 1.05 }, lead: !!a.is_lead });
    });
  }

  return { cols, width, height, rooms, desks, roomOf, lobbySpawn: { x: width / 2, y: 2 } };
}
