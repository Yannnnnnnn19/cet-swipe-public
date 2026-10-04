import { useEffect, useMemo, useState } from "react";
import type { CetOfficialDataset, CetOfficialEntry } from "./types/vocabulary";
import {
  getAllProgress,
  saveRecognition,
  type WordProgress,
} from "./lib/progressDb";

const priorityLabel: Record<CetOfficialEntry["study_priority"]["tier"], string> = {
  A: "重点 · 多源高频",
  B: "高频",
  C: "专项高频",
  N: "官方词表",
};

function stableHash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function familyText(entry: CetOfficialEntry): string {
  return entry.family
    .slice(0, 5)
    .map((item) => item.headword)
    .join(" · ");
}

export default function App() {
  const [data, setData] = useState<CetOfficialDataset | null>(null);
  const [progress, setProgress] = useState<Map<string, WordProgress>>(new Map());
  const [loading, setLoading] = useState(true);
  const [started, setStarted] = useState(false);
  const [revealedEntry, setRevealedEntry] = useState<CetOfficialEntry | null>(null);

  useEffect(() => {
    async function init() {
      const [dataset, saved] = await Promise.all([
        fetch(`${import.meta.env.BASE_URL}data/vocabulary.json`).then((r) => {
          if (!r.ok) throw new Error(`Failed to load vocabulary: ${r.status}`);
          return r.json() as Promise<CetOfficialDataset>;
        }),
        getAllProgress(),
      ]);
      setData(dataset);
      setProgress(new Map(saved.map((item) => [item.id, item])));
      setLoading(false);
    }

    init().catch((error) => {
      console.error(error);
      setLoading(false);
    });
  }, []);

  const queue = useMemo(() => {
    if (!data) return [];
    return [...data.entries]
      .filter((entry) => !progress.has(entry.id))
      .sort((a, b) => stableHash(a.id) - stableHash(b.id));
  }, [data, progress]);

  const current = queue[0] ?? null;
  const displayEntry = revealedEntry ?? current;
  const isRevealed = revealedEntry !== null;
  const total = data?.entries.length ?? 0;
  const completed = progress.size;
  const dailyTarget = total ? Math.ceil(total / 10) : 0;
  const familiarCount = [...progress.values()].filter((p) => p.status === "FAMILIAR").length;
  const unknownCount = [...progress.values()].filter((p) => p.status === "UNKNOWN").length;
  const percent = total ? Math.round((completed / total) * 100) : 0;

  async function chooseKnown() {
    if (!current || isRevealed) return;
    const selected = current;
    const saved = await saveRecognition(selected.id, "FAMILIAR");
    setProgress((prev) => new Map(prev).set(selected.id, saved));
  }

  async function chooseUnknown() {
    if (!current || isRevealed) return;

    // Freeze the selected card before updating progress. Updating progress removes
    // the word from the queue immediately, so rendering from `current` here
    // would otherwise show the *next* word's definition.
    const selected = current;
    setRevealedEntry(selected);

    const saved = await saveRecognition(selected.id, "UNKNOWN");
    setProgress((prev) => new Map(prev).set(selected.id, saved));
  }

  function continueAfterReveal() {
    setRevealedEntry(null);
  }

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (!started) return;

      if (isRevealed) {
        if (event.key === "ArrowRight" || event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          continueAfterReveal();
        }
        return;
      }

      if (!current) return;

      if (event.key === "ArrowLeft") {
        event.preventDefault();
        void chooseKnown();
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        void chooseUnknown();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  if (loading) {
    return <main className="shell"><div className="panel">正在加载词库…</div></main>;
  }

  if (!data) {
    return <main className="shell"><div className="panel">词库加载失败，请检查生成数据。</div></main>;
  }

  if (started) {
    return (
      <main className="shell study-shell">
        <header className="study-topbar">
          <button className="ghost" onClick={() => setStarted(false)}>← 返回</button>
          <div className="study-progress-text">{completed} / {total} · {percent}%</div>
        </header>

        <section className="study-card">
          {displayEntry ? (
            <>
              <div className="word-meta">
                <span className={`priority priority-${displayEntry.study_priority.tier}`}>
                  {priorityLabel[displayEntry.study_priority.tier]}
                </span>
                {displayEntry.cet6 && <span className="cet6-mark">★ CET-6</span>}
              </div>

              <div className="word-main">
                <h1>{displayEntry.headword}</h1>
                {displayEntry.homonym_index && <span className="sense-index">{displayEntry.homonym_index}</span>}
              </div>

              {displayEntry.lexical?.phonetic && (
                <p className="phonetic">/{current.lexical.phonetic}/</p>
              )}

              {!isRevealed ? (
                <>
                  <p className="hint">只判断：看到这个词，你是否知道它的常用意思和基本用法？</p>
                  <div className="swipe-actions">
                    <button className="known-btn" onClick={() => void chooseKnown()}>
                      <span>←</span>
                      <strong>认识</strong>
                      <small>不用复习</small>
                    </button>
                    <button className="unknown-btn" onClick={() => void chooseUnknown()}>
                      <strong>不知道</strong>
                      <small>显示释义并加入复习</small>
                      <span>→</span>
                    </button>
                  </div>
                </>
              ) : (
                <div className="reveal-box">
                  <p className="reveal-label">已加入待学词</p>
                  <p className="translation">
                    {displayEntry.lexical?.translation ?? "暂无中文释义，后续进入 fallback 队列。"}
                  </p>

                  {displayEntry.lexical?.pos?.length ? (
                    <p className="detail-line">
                      词性：{current.lexical.pos.slice(0, 4).map((p) => p.tag).join(" / ")}
                    </p>
                  ) : null}

                  {familyText(displayEntry) && (
                    <p className="detail-line">词族：{familyText(displayEntry)}</p>
                  )}

                  {displayEntry.variants.length > 0 && (
                    <p className="detail-line">变体：{displayEntry.variants.join(" / ")}</p>
                  )}

                  <button className="primary continue-btn" onClick={continueAfterReveal}>
                    继续 →
                  </button>
                  <p className="key-tip">按 → / Enter / Space 继续</p>
                </div>
              )}
            </>
          ) : (
            <div className="complete-box">
              <h2>第一轮识别完成</h2>
              <p>所有官方学习单元都已经完成一次识别判断。</p>
              <button className="primary" onClick={() => setStarted(false)}>查看统计</button>
            </div>
          )}
        </section>

        <footer className="study-footer">
          <span>认识 {familiarCount}</span>
          <span>待学 {unknownCount}</span>
          <span>剩余 {queue.length}</span>
        </footer>
      </main>
    );
  }

  return (
    <main className="shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">CET Swipe</p>
          <h1>30-Day Vocabulary Challenge</h1>
        </div>
        <div className="day-pill">Phase 1 · Scan</div>
      </header>

      <section className="hero-card">
        <div>
          <p className="eyebrow">当前任务</p>
          <h2>10 天扫完官方 CET 词表</h2>
          <p className="muted">
            共 {total} 个可见学习单元；每天约 {dailyTarget} 个。顺序已打乱，避免按字母机械刷词。
          </p>
        </div>
        <button className="primary" onClick={() => setStarted(true)}>
          {completed ? "继续 Swipe" : "开始 Swipe"}
        </button>
      </section>

      <section className="grid">
        <article className="panel">
          <div className="panel-head">
            <h3>Vocabulary Scan</h3>
            <span>{completed} / {total}</span>
          </div>
          <div className="progress"><span style={{ width: `${percent}%` }} /></div>
          <p className="muted">← 认识 · → 不知道</p>
        </article>

        <article className="panel">
          <div className="panel-head">
            <h3>已认识</h3>
            <span>{familiarCount}</span>
          </div>
          <p className="stat-number">{familiarCount}</p>
          <p className="muted">后续会随机抽样做 Context Check，识别“假熟悉”。</p>
        </article>

        <article className="panel">
          <div className="panel-head">
            <h3>待学习</h3>
            <span>{unknownCount}</span>
          </div>
          <p className="stat-number">{unknownCount}</p>
          <p className="muted">右划后的词会进入下一阶段的重点复习池。</p>
        </article>
      </section>

      <section className="panel states">
        <div className="panel-head">
          <h3>词库优先级</h3>
          <span>来自官方词表 + 3 份高频资料</span>
        </div>
        <div className="chips">
          <span className="chip">A · 多源高频</span>
          <span className="chip">B · 综合高频</span>
          <span className="chip">C · 听力/翻译专项</span>
          <span className="chip">N · 官方词表</span>
        </div>
      </section>
    </main>
  );
}
