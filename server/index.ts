import express from "express";
import path from "node:path";
import fs from "node:fs";
import { db, q } from "./db.ts";
import { addClient, broadcast } from "./events.ts";
import { enqueue } from "./orchestrator.ts";
import { DEMO_MODE, MODEL } from "./llm.ts";

const app = express();
app.use(express.json());

const str = (v: unknown, max = 4000) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const color = (v: unknown, fallback: string) =>
  typeof v === "string" && /^#[0-9a-fA-F]{6}$/.test(v) ? v : fallback;

app.get("/api/info", (_req, res) => res.json({ demo: DEMO_MODE, model: MODEL }));
app.get("/api/events", (_req, res) => addClient(res));

app.get("/api/state", (_req, res) => {
  res.json({ departments: q.departments(), agents: q.agents(), tasks: q.tasks() });
});

// ── 부서 ──
app.post("/api/departments", (req, res) => {
  const name = str(req.body.name, 40);
  if (!name) return res.status(400).json({ error: "부서 이름을 입력하세요." });
  const r = db
    .prepare("INSERT INTO departments (name, description, color) VALUES (?,?,?)")
    .run(name, str(req.body.description), color(req.body.color, "#6c8ebf"));
  broadcast({ type: "org_changed" });
  res.json(q.department(Number(r.lastInsertRowid)));
});

app.patch("/api/departments/:id", (req, res) => {
  const d = q.department(Number(req.params.id));
  if (!d) return res.status(404).json({ error: "부서를 찾을 수 없습니다." });
  db.prepare("UPDATE departments SET name=?, description=?, color=? WHERE id=?").run(
    str(req.body.name, 40) || d.name,
    req.body.description !== undefined ? str(req.body.description) : d.description,
    color(req.body.color, d.color),
    d.id,
  );
  broadcast({ type: "org_changed" });
  res.json(q.department(d.id));
});

app.delete("/api/departments/:id", (req, res) => {
  const id = Number(req.params.id);
  const active = db
    .prepare("SELECT COUNT(*) AS c FROM tasks WHERE department_id=? AND status NOT IN ('done','failed')")
    .get(id) as { c: number };
  if (active.c > 0) return res.status(409).json({ error: "진행 중인 업무가 있어 삭제할 수 없습니다." });
  db.prepare("DELETE FROM departments WHERE id=?").run(id);
  broadcast({ type: "org_changed" });
  res.json({ ok: true });
});

// ── 직원(AI 에이전트) ──
app.post("/api/agents", (req, res) => {
  const deptId = Number(req.body.department_id);
  const name = str(req.body.name, 20);
  if (!q.department(deptId)) return res.status(400).json({ error: "부서를 선택하세요." });
  if (!name) return res.status(400).json({ error: "이름을 입력하세요." });
  if (q.agentsByDept(deptId).length >= 8)
    return res.status(400).json({ error: "한 부서에는 최대 8명까지 배치할 수 있습니다." });
  const isLead = req.body.is_lead ? 1 : 0;
  if (isLead) db.prepare("UPDATE agents SET is_lead=0 WHERE department_id=?").run(deptId);
  const r = db
    .prepare(
      "INSERT INTO agents (department_id, name, title, persona, color, is_lead) VALUES (?,?,?,?,?,?)",
    )
    .run(deptId, name, str(req.body.title, 20) || "사원", str(req.body.persona), color(req.body.color, "#4a90d9"), isLead);
  broadcast({ type: "org_changed" });
  res.json(q.agent(Number(r.lastInsertRowid)));
});

app.patch("/api/agents/:id", (req, res) => {
  const a = q.agent(Number(req.params.id));
  if (!a) return res.status(404).json({ error: "직원을 찾을 수 없습니다." });
  const deptId = req.body.department_id !== undefined ? Number(req.body.department_id) : a.department_id;
  if (!q.department(deptId)) return res.status(400).json({ error: "부서가 올바르지 않습니다." });
  if (deptId !== a.department_id && q.agentsByDept(deptId).length >= 8)
    return res.status(400).json({ error: "그 부서는 이미 정원(8명)이 찼습니다." });
  // 다른 부서로 옮기면 명시하지 않는 한 팀장 직책은 해제
  const isLead =
    req.body.is_lead !== undefined ? (req.body.is_lead ? 1 : 0) : deptId !== a.department_id ? 0 : a.is_lead;
  if (isLead) db.prepare("UPDATE agents SET is_lead=0 WHERE department_id=?").run(deptId);
  db.prepare(
    "UPDATE agents SET department_id=?, name=?, title=?, persona=?, color=?, is_lead=? WHERE id=?",
  ).run(
    deptId,
    str(req.body.name, 20) || a.name,
    str(req.body.title, 20) || a.title,
    req.body.persona !== undefined ? str(req.body.persona) : a.persona,
    color(req.body.color, a.color),
    isLead,
    a.id,
  );
  broadcast({ type: "org_changed" });
  res.json(q.agent(a.id));
});

app.delete("/api/agents/:id", (req, res) => {
  const a = q.agent(Number(req.params.id));
  if (!a) return res.status(404).json({ error: "직원을 찾을 수 없습니다." });
  if (a.status !== "idle") return res.status(409).json({ error: "업무 중인 직원은 내보낼 수 없습니다." });
  db.prepare("DELETE FROM agents WHERE id=?").run(a.id);
  broadcast({ type: "org_changed" });
  res.json({ ok: true });
});

// ── 업무 ──
app.post("/api/tasks", (req, res) => {
  const deptId = Number(req.body.department_id);
  const title = str(req.body.title, 120);
  if (!q.department(deptId)) return res.status(400).json({ error: "부서를 선택하세요." });
  if (!title) return res.status(400).json({ error: "업무 제목을 입력하세요." });
  if (q.agentsByDept(deptId).length === 0)
    return res.status(400).json({ error: "이 부서에는 직원이 없습니다. 먼저 직원을 채용하세요." });
  const r = db
    .prepare("INSERT INTO tasks (department_id, title, description) VALUES (?,?,?)")
    .run(deptId, title, str(req.body.description, 8000));
  const id = Number(r.lastInsertRowid);
  broadcast({ type: "task_update", taskId: id });
  enqueue(deptId);
  res.json(q.task(id));
});

app.get("/api/tasks/:id", (req, res) => {
  const t = q.task(Number(req.params.id));
  if (!t) return res.status(404).json({ error: "업무를 찾을 수 없습니다." });
  res.json({ task: t, steps: q.steps(t.id) });
});

app.get("/api/steps/:id", (req, res) => {
  const s = q.step(Number(req.params.id));
  if (!s) return res.status(404).json({ error: "없음" });
  res.json(s);
});

app.delete("/api/tasks/:id", (req, res) => {
  const t = q.task(Number(req.params.id));
  if (!t) return res.status(404).json({ error: "업무를 찾을 수 없습니다." });
  if (!["done", "failed", "queued"].includes(t.status))
    return res.status(409).json({ error: "진행 중인 업무는 삭제할 수 없습니다." });
  db.prepare("DELETE FROM tasks WHERE id=?").run(t.id);
  broadcast({ type: "task_update", taskId: t.id });
  res.json({ ok: true });
});

// 빌드된 프론트엔드 제공 (npm run build 후)
const dist = path.resolve(process.cwd(), "dist");
if (fs.existsSync(dist)) {
  app.use(express.static(dist));
  app.get(/^\/(?!api).*/, (_req, res) => res.sendFile(path.join(dist, "index.html")));
}

const PORT = Number(process.env.PORT || 3001);
app.listen(PORT, () => {
  console.log(`AI 오피스 서버: http://localhost:${PORT}  (${DEMO_MODE ? "데모 모드" : `모델 ${MODEL}`})`);
  for (const d of q.departments()) enqueue(d.id); // 재시작 전 대기 중이던 업무 이어서 처리
});
