import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";

const DATA_DIR = path.resolve(process.cwd(), "data");
fs.mkdirSync(DATA_DIR, { recursive: true });

export const db = new DatabaseSync(path.join(DATA_DIR, "office.db"));
db.exec("PRAGMA foreign_keys = ON;");

db.exec(`
CREATE TABLE IF NOT EXISTS departments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  color TEXT NOT NULL DEFAULT '#6c8ebf',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS agents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  department_id INTEGER NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '사원',
  persona TEXT NOT NULL DEFAULT '',
  color TEXT NOT NULL DEFAULT '#4a90d9',
  is_lead INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'idle',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  department_id INTEGER NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'queued',
  result TEXT,
  error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  finished_at TEXT
);
CREATE TABLE IF NOT EXISTS task_steps (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  agent_id INTEGER REFERENCES agents(id) ON DELETE SET NULL,
  kind TEXT NOT NULL,
  instruction TEXT NOT NULL DEFAULT '',
  content TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'running',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`);

// 서버가 재시작되면 진행 중이던 상태를 정리
db.exec(`UPDATE agents SET status='idle';`);
db.exec(`UPDATE tasks SET status='failed', error='서버 재시작으로 중단됨' WHERE status NOT IN ('done','failed','queued');`);
db.exec(`UPDATE task_steps SET status='failed' WHERE status='running';`);

export type Department = {
  id: number;
  name: string;
  description: string;
  color: string;
  created_at: string;
};
export type Agent = {
  id: number;
  department_id: number;
  name: string;
  title: string;
  persona: string;
  color: string;
  is_lead: number;
  status: string;
  created_at: string;
};
export type Task = {
  id: number;
  department_id: number;
  title: string;
  description: string;
  status: string;
  result: string | null;
  error: string | null;
  created_at: string;
  finished_at: string | null;
};
export type TaskStep = {
  id: number;
  task_id: number;
  agent_id: number | null;
  kind: "plan" | "work" | "summary";
  instruction: string;
  content: string;
  status: string;
  created_at: string;
};

export const q = {
  departments: () => db.prepare("SELECT * FROM departments ORDER BY id").all() as Department[],
  department: (id: number) =>
    db.prepare("SELECT * FROM departments WHERE id=?").get(id) as Department | undefined,
  agents: () => db.prepare("SELECT * FROM agents ORDER BY department_id, is_lead DESC, id").all() as Agent[],
  agent: (id: number) => db.prepare("SELECT * FROM agents WHERE id=?").get(id) as Agent | undefined,
  agentsByDept: (deptId: number) =>
    db
      .prepare("SELECT * FROM agents WHERE department_id=? ORDER BY is_lead DESC, id")
      .all(deptId) as Agent[],
  tasks: () => db.prepare("SELECT * FROM tasks ORDER BY id DESC LIMIT 100").all() as Task[],
  task: (id: number) => db.prepare("SELECT * FROM tasks WHERE id=?").get(id) as Task | undefined,
  steps: (taskId: number) =>
    db.prepare("SELECT * FROM task_steps WHERE task_id=? ORDER BY id").all(taskId) as TaskStep[],
  step: (id: number) => db.prepare("SELECT * FROM task_steps WHERE id=?").get(id) as TaskStep | undefined,
};

function seed() {
  const count = (db.prepare("SELECT COUNT(*) AS c FROM departments").get() as { c: number }).c;
  if (count > 0) return;

  const insDept = db.prepare("INSERT INTO departments (name, description, color) VALUES (?,?,?)");
  const insAgent = db.prepare(
    "INSERT INTO agents (department_id, name, title, persona, color, is_lead) VALUES (?,?,?,?,?,?)",
  );

  const plan = Number(
    insDept.run("기획팀", "제품 전략과 기획 문서를 담당합니다.", "#e0a458").lastInsertRowid,
  );
  insAgent.run(plan, "한기획", "팀장", "10년차 서비스 기획자. 큰 그림을 보고 일을 나눈다.", "#c0392b", 1);
  insAgent.run(plan, "이리서치", "선임", "시장 조사와 경쟁사 분석에 강하다. 근거를 꼭 제시한다.", "#8e44ad", 0);
  insAgent.run(plan, "박문서", "사원", "요구사항을 깔끔한 문서로 정리하는 것을 좋아한다.", "#16a085", 0);

  const dev = Number(
    insDept.run("개발팀", "설계, 구현, 코드 리뷰를 담당합니다.", "#5b8bd9").lastInsertRowid,
  );
  insAgent.run(dev, "김개발", "팀장", "아키텍트. 트레이드오프를 짧게 정리하고 결정한다.", "#2c3e50", 1);
  insAgent.run(dev, "정프론트", "선임", "프론트엔드 개발자. UX와 접근성에 신경 쓴다.", "#2980b9", 0);
  insAgent.run(dev, "최백엔드", "선임", "백엔드 개발자. 데이터 모델과 API 설계에 강하다.", "#27ae60", 0);

  const mkt = Number(
    insDept.run("마케팅팀", "브랜딩, 카피, 캠페인을 담당합니다.", "#d96b9c").lastInsertRowid,
  );
  insAgent.run(mkt, "오마케", "팀장", "퍼포먼스 마케터 출신. 숫자와 타깃을 먼저 묻는다.", "#d35400", 1);
  insAgent.run(mkt, "윤카피", "사원", "카피라이터. 짧고 기억에 남는 문장을 쓴다.", "#e84393", 0);
}
seed();
