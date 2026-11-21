import { useState } from "react";
import { useOffice } from "./api";
import OfficeCanvas from "./office/OfficeCanvas";
import { AgentForm, DeptForm, OrgTab, TaskDetail, TaskForm, TasksTab, type FormState } from "./Panels";

export default function App() {
  const office = useOffice();
  const { departments, agents, tasks, info, connected } = office;
  const [tab, setTab] = useState<"org" | "tasks">("org");
  const [selAgent, setSelAgent] = useState<number | null>(null);
  const [selDept, setSelDept] = useState<number | null>(null);
  const [form, setForm] = useState<FormState | null>(null);
  const [openTask, setOpenTask] = useState<number | null>(null);

  const activeTasks = tasks.filter((t) => !["done", "failed"].includes(t.status)).length;
  const busyAgents = agents.filter((a) => a.status !== "idle").length;

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="logo" aria-hidden>▦</span>
          <h1>AI 오피스</h1>
        </div>
        <div className="stats">
          <span>부서 <b>{departments.length}</b></span>
          <span>직원 <b>{agents.length}</b></span>
          <span>근무 중 <b>{busyAgents}</b></span>
          <span>진행 업무 <b>{activeTasks}</b></span>
        </div>
        <div className="top-right">
          {info && (
            <span className={`mode ${info.demo ? "demo" : "live"}`} title={info.demo ? "ANTHROPIC_API_KEY를 설정하면 실제 AI가 일합니다" : "실제 Claude API 사용 중"}>
              {info.demo ? "데모 모드" : info.model}
            </span>
          )}
          <span className={`conn ${connected ? "on" : ""}`} title={connected ? "실시간 연결됨" : "연결 끊김"} />
          <button className="btn primary" onClick={() => setForm({ kind: "task", deptId: selDept ?? undefined })} disabled={departments.length === 0}>
            + 업무 지시
          </button>
        </div>
      </header>

      <main className="main">
        <section className="map" aria-label="사무실 지도">
          <OfficeCanvas
            departments={departments}
            agents={agents}
            selectedAgentId={selAgent}
            selectedDeptId={selDept}
            onSelectAgent={(id) => {
              setSelAgent(id);
              setSelDept(agents.find((a) => a.id === id)?.department_id ?? null);
              setTab("org");
            }}
            onSelectDept={(id) => {
              setSelDept(id);
              setSelAgent(null);
              setTab("org");
            }}
            onNewDept={() => setForm({ kind: "dept" })}
          />
        </section>

        <aside className="side">
          <div className="tabs">
            <button className={tab === "org" ? "on" : ""} onClick={() => setTab("org")}>조직 관리</button>
            <button className={tab === "tasks" ? "on" : ""} onClick={() => setTab("tasks")}>
              업무 {activeTasks > 0 && <span className="count">{activeTasks}</span>}
            </button>
          </div>
          {tab === "org" ? (
            <OrgTab
              office={office}
              selectedAgentId={selAgent}
              selectedDeptId={selDept}
              onSelectAgent={(id) => {
                setSelAgent(id);
                if (id) setSelDept(agents.find((a) => a.id === id)?.department_id ?? null);
              }}
              onSelectDept={(id) => {
                setSelDept(id);
                setSelAgent(null);
              }}
              openForm={setForm}
            />
          ) : (
            <TasksTab office={office} onOpen={setOpenTask} openForm={setForm} />
          )}
        </aside>
      </main>

      {form?.kind === "dept" && <DeptForm dept={form.dept} onClose={() => setForm(null)} onSaved={(d) => setSelDept(d.id)} />}
      {form?.kind === "agent" && <AgentForm agent={form.agent} departments={departments} defaultDept={form.deptId ?? selDept ?? undefined} onClose={() => setForm(null)} />}
      {form?.kind === "task" && (
        <TaskForm departments={departments} defaultDept={form.deptId} onClose={() => setForm(null)} onCreated={(t) => { setTab("tasks"); setOpenTask(t.id); }} />
      )}
      {openTask !== null && <TaskDetail taskId={openTask} office={office} onClose={() => setOpenTask(null)} />}
    </div>
  );
}
