import { db, q, type Agent } from "./db.ts";
import { broadcast } from "./events.ts";
import { makePlan, streamText } from "./llm.ts";

function setAgent(agent: Agent, status: string, message?: string) {
  db.prepare("UPDATE agents SET status=? WHERE id=?").run(status, agent.id);
  broadcast({ type: "agent_status", agentId: agent.id, status, message });
}

function setTask(taskId: number, fields: Record<string, string | null>) {
  const keys = Object.keys(fields);
  db.prepare(`UPDATE tasks SET ${keys.map((k) => `${k}=?`).join(",")} WHERE id=?`).run(
    ...keys.map((k) => fields[k]),
    taskId,
  );
  broadcast({ type: "task_update", taskId });
}

function createStep(taskId: number, agentId: number, kind: string, instruction = "") {
  const id = Number(
    db
      .prepare("INSERT INTO task_steps (task_id, agent_id, kind, instruction) VALUES (?,?,?,?)")
      .run(taskId, agentId, kind, instruction).lastInsertRowid,
  );
  broadcast({ type: "step_created", taskId, stepId: id });
  return id;
}

function finishStep(taskId: number, stepId: number, content: string, status = "done") {
  db.prepare("UPDATE task_steps SET content=?, status=? WHERE id=?").run(content, status, stepId);
  broadcast({ type: "step_done", taskId, stepId });
}

/** 스트리밍 조각을 DB에 너무 자주 쓰지 않도록 묶어서 저장 */
function streamToStep(taskId: number, stepId: number) {
  let buf = "";
  let last = Date.now();
  return (text: string) => {
    buf += text;
    broadcast({ type: "step_delta", taskId, stepId, text });
    if (Date.now() - last > 500) {
      db.prepare("UPDATE task_steps SET content=? WHERE id=?").run(buf, stepId);
      last = Date.now();
    }
  };
}

function agentSystem(agent: Agent, deptName: string) {
  return [
    `당신은 가상 회사 "AI 오피스"의 ${deptName} 소속 ${agent.title} "${agent.name}"입니다.`,
    agent.persona ? `성격과 전문성: ${agent.persona}` : "",
    "항상 한국어로, 실무에서 바로 쓸 수 있는 결과물을 작성하세요. 마크다운을 사용해도 됩니다.",
  ]
    .filter(Boolean)
    .join("\n");
}

/** 부서마다 한 번에 하나의 업무만 진행하고, 나머지는 대기열에서 순서대로 처리 */
const busyDepts = new Set<number>();

export function enqueue(departmentId: number) {
  if (busyDepts.has(departmentId)) return;
  const next = db
    .prepare("SELECT id FROM tasks WHERE department_id=? AND status='queued' ORDER BY id LIMIT 1")
    .get(departmentId) as { id: number } | undefined;
  if (!next) return;
  busyDepts.add(departmentId);
  runTask(next.id).finally(() => {
    busyDepts.delete(departmentId);
    enqueue(departmentId);
  });
}

const running = new Set<number>();

async function runTask(taskId: number) {
  if (running.has(taskId)) return;
  running.add(taskId);
  const busy: Agent[] = [];
  try {
    const task = q.task(taskId)!;
    const dept = q.department(task.department_id)!;
    const agents = q.agentsByDept(dept.id);
    if (agents.length === 0) throw new Error("이 부서에는 직원이 없습니다. 먼저 직원을 채용하세요.");

    const lead = agents.find((a) => a.is_lead) ?? agents[0];
    const members = agents.filter((a) => a.id !== lead.id);
    busy.push(lead);
    const taskText = `업무 제목: ${task.title}\n업무 내용: ${task.description || "(추가 설명 없음)"}`;

    // 1) 팀장이 업무 배분
    let assignments: { agent: Agent; instruction: string }[];
    if (members.length === 0) {
      assignments = [{ agent: lead, instruction: "이 업무를 직접 처리하세요." }];
    } else {
      setTask(taskId, { status: "planning" });
      setAgent(lead, "thinking", "업무 배분 중…");
      const planStep = createStep(taskId, lead.id, "plan");
      const roster = members
        .map((m) => `- id=${m.id} ${m.name} (${m.title}): ${m.persona || "특이사항 없음"}`)
        .join("\n");
      const plan = await makePlan(
        agentSystem(lead, dept.name) + "\n당신은 팀장으로서 업무를 팀원에게 배분합니다.",
        `${taskText}\n\n팀원 목록:\n${roster}\n\n각 팀원의 강점에 맞게 업무를 나누세요. 지시는 구체적으로 작성하세요.`,
        members.map((m) => m.id),
      );
      assignments = plan.assignments
        .map((a) => ({ agent: members.find((m) => m.id === a.agent_id)!, instruction: a.instruction }))
        .filter((a) => a.agent);
      if (assignments.length === 0) assignments = [{ agent: lead, instruction: "이 업무를 직접 처리하세요." }];
      const planText =
        plan.analysis +
        "\n\n" +
        assignments.map((a) => `- **${a.agent.name}**: ${a.instruction}`).join("\n");
      finishStep(taskId, planStep, planText);
      setAgent(lead, "waiting", "팀원 작업 대기");
    }

    // 2) 팀원들이 병렬로 작업
    setTask(taskId, { status: "working" });
    const results = await Promise.all(
      assignments.map(async ({ agent, instruction }) => {
        busy.push(agent);
        setAgent(agent, "working", "작업 중…");
        const stepId = createStep(taskId, agent.id, "work", instruction);
        const text = await streamText(
          agentSystem(agent, dept.name),
          `${taskText}\n\n팀장(${lead.name})의 지시: ${instruction}\n\n지시받은 부분에 대한 결과물을 작성하세요.`,
          streamToStep(taskId, stepId),
        );
        finishStep(taskId, stepId, text);
        setAgent(agent, agent.id === lead.id ? "thinking" : "meeting", "작업 완료");
        return { agent, text };
      }),
    );

    // 3) 팀장이 결과 종합 (팀원이 있을 때만)
    let finalText = results[0].text;
    if (members.length > 0) {
      setTask(taskId, { status: "reviewing" });
      setAgent(lead, "thinking", "결과 종합 중…");
      const stepId = createStep(taskId, lead.id, "summary");
      const merged = results.map((r) => `### ${r.agent.name} (${r.agent.title})\n${r.text}`).join("\n\n");
      finalText = await streamText(
        agentSystem(lead, dept.name),
        `${taskText}\n\n팀원들의 결과물:\n\n${merged}\n\n팀장으로서 이 결과물을 종합해 대표에게 올릴 최종 보고서를 작성하세요.`,
        streamToStep(taskId, stepId),
      );
      finishStep(taskId, stepId, finalText);
    }

    setTask(taskId, { status: "done", result: finalText, finished_at: new Date().toISOString() });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[task ${taskId}]`, err);
    db.prepare("UPDATE task_steps SET status='failed' WHERE task_id=? AND status='running'").run(taskId);
    setTask(taskId, { status: "failed", error: msg, finished_at: new Date().toISOString() });
  } finally {
    for (const a of busy) setAgent(a, "idle");
    running.delete(taskId);
  }
}
