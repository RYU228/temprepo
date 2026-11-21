import { useEffect, useState, type ReactNode } from "react";
import { api, STATUS_LABEL, TASK_LABEL, type Agent, type Department, type Office, type Task, type TaskStep } from "./api";
import Markdown from "./Markdown";

const PALETTE = ["#e0a458", "#5b8bd9", "#d96b9c", "#5fb37a", "#9b7fd1", "#e07a5f", "#3fa7a7", "#b0a060"];
const SHIRTS = ["#c0392b", "#8e44ad", "#16a085", "#2c3e50", "#2980b9", "#27ae60", "#d35400", "#e84393", "#7f8c8d", "#f39c12"];

export function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  return (
    <div className="modal-bg" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${wide ? "wide" : ""}`} role="dialog" aria-label={title}>
        <div className="modal-head">
          <h3>{title}</h3>
          <button className="icon-btn" onClick={onClose} aria-label="닫기">✕</button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}

function ColorPicker({ value, onChange, colors }: { value: string; onChange: (c: string) => void; colors: string[] }) {
  return (
    <div className="swatches">
      {colors.map((c) => (
        <button key={c} type="button" className={`swatch ${c === value ? "on" : ""}`} style={{ background: c }} onClick={() => onChange(c)} aria-label={c} />
      ))}
    </div>
  );
}

function useSubmit() {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError("");
    try {
      await fn();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return false;
    } finally {
      setBusy(false);
    }
  };
  return { error, busy, run };
}

// ───────── 부서 ─────────
export function DeptForm({ dept, onClose, onSaved }: { dept?: Department; onClose: () => void; onSaved?: (d: Department) => void }) {
  const [name, setName] = useState(dept?.name ?? "");
  const [description, setDescription] = useState(dept?.description ?? "");
  const [color, setColor] = useState(dept?.color ?? PALETTE[Math.floor(Math.random() * PALETTE.length)]);
  const { error, busy, run } = useSubmit();
  return (
    <Modal title={dept ? "부서 수정" : "새 부서 만들기"} onClose={onClose}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          let saved: Department | undefined;
          const ok = await run(async () => {
            saved = await api<Department>(dept ? `/api/departments/${dept.id}` : "/api/departments", dept ? "PATCH" : "POST", { name, description, color });
          });
          if (ok) {
            if (saved) onSaved?.(saved);
            onClose();
          }
        }}
      >
        <label>부서 이름<input value={name} onChange={(e) => setName(e.target.value)} placeholder="예: 디자인팀" autoFocus maxLength={40} /></label>
        <label>하는 일<textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="이 부서가 담당하는 업무" rows={3} /></label>
        <label>방 색상</label>
        <ColorPicker value={color} onChange={setColor} colors={PALETTE} />
        {error && <p className="error">{error}</p>}
        <div className="actions">
          <button type="button" className="btn ghost" onClick={onClose}>취소</button>
          <button className="btn primary" disabled={busy}>{dept ? "저장" : "만들기"}</button>
        </div>
      </form>
    </Modal>
  );
}

// ───────── 직원 ─────────
export function AgentForm({ agent, departments, defaultDept, onClose }: { agent?: Agent; departments: Department[]; defaultDept?: number; onClose: () => void }) {
  const [name, setName] = useState(agent?.name ?? "");
  const [title, setTitle] = useState(agent?.title ?? "사원");
  const [persona, setPersona] = useState(agent?.persona ?? "");
  const [deptId, setDeptId] = useState<number>(agent?.department_id ?? defaultDept ?? departments[0]?.id ?? 0);
  const [isLead, setIsLead] = useState(!!agent?.is_lead);
  const [color, setColor] = useState(agent?.color ?? SHIRTS[Math.floor(Math.random() * SHIRTS.length)]);
  const { error, busy, run } = useSubmit();
  return (
    <Modal title={agent ? `${agent.name} 정보 수정` : "AI 직원 채용"} onClose={onClose}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          const body = { name, title, persona, department_id: deptId, is_lead: isLead, color };
          if (await run(() => api(agent ? `/api/agents/${agent.id}` : "/api/agents", agent ? "PATCH" : "POST", body))) onClose();
        }}
      >
        <div className="row2">
          <label>이름<input value={name} onChange={(e) => setName(e.target.value)} placeholder="예: 김디자" autoFocus maxLength={20} /></label>
          <label>직급<input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={20} /></label>
        </div>
        <label>소속 부서
          <select value={deptId} onChange={(e) => setDeptId(Number(e.target.value))}>
            {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </label>
        <label>성격 · 전문성 (AI에게 주는 역할 설명)
          <textarea value={persona} onChange={(e) => setPersona(e.target.value)} rows={4} placeholder="예: UI 디자이너. 사용자 관점에서 화면 흐름을 설계하고 근거를 함께 제시한다." />
        </label>
        <label className="check"><input type="checkbox" checked={isLead} onChange={(e) => setIsLead(e.target.checked)} /> 팀장으로 지정 (업무를 받아 팀원에게 배분하고 결과를 종합)</label>
        <label>옷 색상</label>
        <ColorPicker value={color} onChange={setColor} colors={SHIRTS} />
        {error && <p className="error">{error}</p>}
        <div className="actions">
          <button type="button" className="btn ghost" onClick={onClose}>취소</button>
          <button className="btn primary" disabled={busy}>{agent ? "저장" : "채용하기"}</button>
        </div>
      </form>
    </Modal>
  );
}

// ───────── 업무 지시 ─────────
export function TaskForm({ departments, defaultDept, onClose, onCreated }: { departments: Department[]; defaultDept?: number; onClose: () => void; onCreated: (t: Task) => void }) {
  const [deptId, setDeptId] = useState<number>(defaultDept ?? departments[0]?.id ?? 0);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const { error, busy, run } = useSubmit();
  return (
    <Modal title="업무 지시" onClose={onClose}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          let t: Task | undefined;
          if (await run(async () => { t = await api<Task>("/api/tasks", "POST", { department_id: deptId, title, description }); })) {
            onClose();
            if (t) onCreated(t);
          }
        }}
      >
        <label>담당 부서
          <select value={deptId} onChange={(e) => setDeptId(Number(e.target.value))}>
            {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </label>
        <label>업무 제목<input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="예: 신규 구독 서비스 런칭 계획 수립" autoFocus maxLength={120} /></label>
        <label>상세 내용<textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={6} placeholder="배경, 목표, 제약 조건, 원하는 결과물 형태 등을 적어주세요." /></label>
        <p className="hint">팀장이 업무를 나눠 팀원에게 배정하고, 팀원들의 결과물을 종합해 최종 보고서를 올립니다.</p>
        {error && <p className="error">{error}</p>}
        <div className="actions">
          <button type="button" className="btn ghost" onClick={onClose}>취소</button>
          <button className="btn primary" disabled={busy}>지시하기</button>
        </div>
      </form>
    </Modal>
  );
}

// ───────── 업무 상세 (실시간) ─────────
const KIND_LABEL = { plan: "업무 배분", work: "작업", summary: "최종 보고" };

export function TaskDetail({ taskId, office, onClose }: { taskId: number; office: Office; onClose: () => void }) {
  const [data, setData] = useState<{ task: Task; steps: TaskStep[] } | null>(null);
  const [tab, setTab] = useState<"result" | "process">("process");

  useEffect(() => {
    let alive = true;
    const load = () => api<{ task: Task; steps: TaskStep[] }>(`/api/tasks/${taskId}`).then((d) => {
      if (!alive) return;
      setData((prev) => {
        // 완료된 업무를 열거나, 보는 중에 완료되면 최종 결과 탭으로 전환
        if (d.task.status === "done" && prev?.task.status !== "done") setTab("result");
        return d;
      });
    }).catch(console.error);
    load();
    const off = office.subscribe((ev) => {
      if ("taskId" in ev && ev.taskId === taskId && ev.type !== "step_delta") load();
    });
    return () => { alive = false; off(); };
  }, [taskId, office.subscribe]);

  if (!data) return <Modal title="업무" onClose={onClose} wide><p>불러오는 중…</p></Modal>;
  const { task, steps } = data;
  const dept = office.departments.find((d) => d.id === task.department_id);
  const agentOf = (id: number | null) => office.agents.find((a) => a.id === id);
  const stepText = (s: TaskStep) => {
    if (s.status !== "running") return s.content;
    const l = office.live.get(s.id);
    if (!l) return s.content;
    return l.sawStart ? l.text : s.content + l.text;
  };
  const active = !["done", "failed"].includes(task.status);

  return (
    <Modal title={task.title} onClose={onClose} wide>
      <div className="task-meta">
        <span className={`badge st-${task.status}`}>{TASK_LABEL[task.status]}</span>
        <span>{dept?.name ?? "삭제된 부서"}</span>
        <span className="muted">{new Date(task.created_at + "Z").toLocaleString("ko-KR")}</span>
      </div>
      {task.description && <p className="task-desc">{task.description}</p>}
      {task.error && <p className="error">⚠ {task.error}</p>}
      <div className="tabs small">
        <button className={tab === "process" ? "on" : ""} onClick={() => setTab("process")}>진행 과정 ({steps.length})</button>
        <button className={tab === "result" ? "on" : ""} onClick={() => setTab("result")} disabled={!task.result}>최종 결과</button>
      </div>
      {tab === "result" && task.result ? (
        <div className="result-box">
          <Markdown text={task.result} />
          <button className="btn ghost sm" onClick={() => navigator.clipboard.writeText(task.result ?? "")}>복사</button>
        </div>
      ) : (
        <div className="steps">
          {steps.length === 0 && <p className="muted">{active ? "곧 시작합니다…" : "기록이 없습니다."}</p>}
          {steps.map((s) => {
            const a = agentOf(s.agent_id);
            const txt = stepText(s);
            return (
              <div key={s.id} className={`step ${s.status}`}>
                <div className="step-head">
                  <span className="dot" style={{ background: a?.color ?? "#999" }} />
                  <b>{a?.name ?? "퇴사한 직원"}</b>
                  <span className="muted">{a?.title}</span>
                  <span className="kind">{KIND_LABEL[s.kind]}</span>
                  {s.status === "running" && <span className="spinner" aria-label="진행 중" />}
                </div>
                {s.instruction && <p className="instruction">지시: {s.instruction}</p>}
                {txt ? <Markdown text={txt} /> : s.status === "running" && <p className="muted">생각 중…</p>}
              </div>
            );
          })}
        </div>
      )}
      {!active && (
        <div className="actions">
          <button className="btn danger ghost sm" onClick={async () => { await api(`/api/tasks/${task.id}`, "DELETE"); onClose(); }}>기록 삭제</button>
        </div>
      )}
    </Modal>
  );
}

// ───────── 사이드바 ─────────
export function OrgTab({ office, selectedAgentId, selectedDeptId, onSelectAgent, onSelectDept, openForm }: {
  office: Office;
  selectedAgentId: number | null;
  selectedDeptId: number | null;
  onSelectAgent: (id: number | null) => void;
  onSelectDept: (id: number | null) => void;
  openForm: (f: FormState) => void;
}) {
  const { departments, agents, tasks } = office;
  const selAgent = agents.find((a) => a.id === selectedAgentId);
  const selDept = departments.find((d) => d.id === selectedDeptId);
  const [err, setErr] = useState("");
  useEffect(() => setErr(""), [selectedAgentId, selectedDeptId]);

  return (
    <div className="tab-body">
      {selAgent && (
        <div className="card detail">
          <div className="detail-head">
            <span className="avatar" style={{ background: selAgent.color }}>{selAgent.name.slice(0, 1)}</span>
            <div>
              <b>{selAgent.name}</b> <span className="muted">{selAgent.title}{selAgent.is_lead ? " · 팀장" : ""}</span>
              <div className="muted small">{departments.find((d) => d.id === selAgent.department_id)?.name} · {STATUS_LABEL[selAgent.status]}</div>
            </div>
            <button className="icon-btn" onClick={() => onSelectAgent(null)} aria-label="닫기">✕</button>
          </div>
          <p className="persona">{selAgent.persona || "역할 설명이 없습니다."}</p>
          {err && <p className="error">{err}</p>}
          <div className="actions left">
            <button className="btn sm" onClick={() => openForm({ kind: "agent", agent: selAgent })}>수정 · 부서 이동</button>
            <button className="btn sm danger ghost" onClick={async () => {
              if (!confirm(`${selAgent.name} 님을 내보낼까요?`)) return;
              try { await api(`/api/agents/${selAgent.id}`, "DELETE"); onSelectAgent(null); } catch (e) { setErr((e as Error).message); }
            }}>내보내기</button>
          </div>
        </div>
      )}
      {selDept && !selAgent && (
        <div className="card detail" style={{ borderTopColor: selDept.color }}>
          <div className="detail-head">
            <span className="avatar sq" style={{ background: selDept.color }}>{selDept.name.slice(0, 1)}</span>
            <div>
              <b>{selDept.name}</b>
              <div className="muted small">직원 {agents.filter((a) => a.department_id === selDept.id).length}명 · 완료 업무 {tasks.filter((t) => t.department_id === selDept.id && t.status === "done").length}건</div>
            </div>
            <button className="icon-btn" onClick={() => onSelectDept(null)} aria-label="닫기">✕</button>
          </div>
          <p className="persona">{selDept.description || "설명이 없습니다."}</p>
          {err && <p className="error">{err}</p>}
          <div className="actions left">
            <button className="btn sm primary" onClick={() => openForm({ kind: "task", deptId: selDept.id })}>업무 지시</button>
            <button className="btn sm" onClick={() => openForm({ kind: "agent", deptId: selDept.id })}>직원 채용</button>
            <button className="btn sm" onClick={() => openForm({ kind: "dept", dept: selDept })}>수정</button>
            <button className="btn sm danger ghost" onClick={async () => {
              if (!confirm(`${selDept.name}를 삭제할까요? 소속 직원과 업무 기록도 함께 삭제됩니다.`)) return;
              try { await api(`/api/departments/${selDept.id}`, "DELETE"); onSelectDept(null); } catch (e) { setErr((e as Error).message); }
            }}>삭제</button>
          </div>
        </div>
      )}

      <div className="section-head">
        <h4>조직도</h4>
        <div>
          <button className="btn sm" onClick={() => openForm({ kind: "dept" })}>+ 부서</button>{" "}
          <button className="btn sm" onClick={() => openForm({ kind: "agent" })} disabled={departments.length === 0}>+ 직원</button>
        </div>
      </div>
      <div className="org">
        <div className="org-ceo">👤 대표 (나)</div>
        {departments.map((d) => {
          const members = agents.filter((a) => a.department_id === d.id);
          return (
            <div key={d.id} className={`org-dept ${d.id === selectedDeptId ? "on" : ""}`}>
              <button className="org-dept-name" onClick={() => onSelectDept(d.id)}>
                <span className="dot sq" style={{ background: d.color }} /> {d.name} <span className="muted">{members.length}</span>
              </button>
              <ul>
                {members.map((a) => (
                  <li key={a.id}>
                    <button className={a.id === selectedAgentId ? "on" : ""} onClick={() => onSelectAgent(a.id)}>
                      <span className="dot" style={{ background: a.color }} />
                      {a.name} <span className="muted">{a.title}</span>
                      {a.is_lead ? <span className="lead">팀장</span> : null}
                      <span className={`st st-${a.status}`}>{STATUS_LABEL[a.status]}</span>
                    </button>
                  </li>
                ))}
                {members.length === 0 && <li className="muted small empty">아직 직원이 없습니다</li>}
              </ul>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function TasksTab({ office, onOpen, openForm }: { office: Office; onOpen: (id: number) => void; openForm: (f: FormState) => void }) {
  const { tasks, departments } = office;
  return (
    <div className="tab-body">
      <div className="section-head">
        <h4>업무 현황</h4>
        <button className="btn sm primary" onClick={() => openForm({ kind: "task" })} disabled={departments.length === 0}>+ 업무 지시</button>
      </div>
      {tasks.length === 0 && <p className="muted empty-state">아직 지시한 업무가 없습니다.<br />부서를 선택하고 업무를 지시해 보세요.</p>}
      <ul className="task-list">
        {tasks.map((t) => {
          const d = departments.find((x) => x.id === t.department_id);
          return (
            <li key={t.id}>
              <button onClick={() => onOpen(t.id)}>
                <span className="dot sq" style={{ background: d?.color ?? "#999" }} />
                <span className="t-title">{t.title}</span>
                <span className={`badge st-${t.status}`}>{TASK_LABEL[t.status]}</span>
                <span className="muted small t-sub">{d?.name} · {new Date(t.created_at + "Z").toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export type FormState =
  | { kind: "dept"; dept?: Department }
  | { kind: "agent"; agent?: Agent; deptId?: number }
  | { kind: "task"; deptId?: number };
