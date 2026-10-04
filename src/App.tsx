import { useCallback, useEffect, useMemo, useState } from "react";
import type { CetOfficialDataset, CetOfficialEntry } from "./types/vocabulary";
import {
  clearSyncConfig,
  getAllProgress,
  getSyncConfig,
  saveRecognition,
  saveSyncConfig,
  type WordProgress,
} from "./lib/progressDb";
import {
  SYNC_REPOSITORY_LABEL,
  syncProgressWithGitHub,
} from "./lib/githubSync";

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

function shortTime(value: string | null): string {
  if (!value) return "尚未同步";
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(value));
}

type SyncState = "off" | "idle" | "syncing" | "error";

export default function App() {
  const [data, setData] = useState<CetOfficialDataset | null>(null);
  const [progress, setProgress] = useState<Map<string, WordProgress>>(new Map());
  const [loading, setLoading] = useState(true);
  const [started, setStarted] = useState(false);
  const [revealedEntry, setRevealedEntry] = useState<CetOfficialEntry | null>(null);

  const [syncToken, setSyncToken] = useState<string | null>(null);
  const [syncTokenInput, setSyncTokenInput] = useState("");
  const [showSyncSetup, setShowSyncSetup] = useState(false);
  const [syncState, setSyncState] = useState<SyncState>("off");
  const [syncMessage, setSyncMessage] = useState("未启用跨设备同步");
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  const [pendingChanges, setPendingChanges] = useState(0);

  useEffect(() => {
    async function init() {
      const [dataset, saved, config] = await Promise.all([
        fetch(`${import.meta.env.BASE_URL}data/vocabulary.json`).then((r) => {
          if (!r.ok) throw new Error(`Failed to load vocabulary: ${r.status}`);
          return r.json() as Promise<CetOfficialDataset>;
        }),
        getAllProgress(),
        getSyncConfig(),
      ]);
      setData(dataset);
      setProgress(new Map(saved.map((item) => [item.id, item])));
      if (config?.enabled && config.token) {
        setSyncToken(config.token);
        setSyncState("idle");
        setSyncMessage("已配置 GitHub Sync");
      }
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

  const syncNow = useCallback(async (tokenOverride?: string) => {
    const token = (tokenOverride ?? syncToken)?.trim();
    if (!token) return;

    setSyncState("syncing");
    setSyncMessage("正在与 GitHub 同步…");

    try {
      const result = await syncProgressWithGitHub(token);
      setProgress(new Map(result.progress.map((item) => [item.id, item])));
      setLastSyncedAt(result.syncedAt);
      setPendingChanges(0);
      setSyncState("idle");

      if (result.pulled > 0) {
        setSyncMessage(`已同步，并合并其他设备的 ${result.pulled} 条记录`);
      } else if (result.pushed) {
        setSyncMessage("本机进度已同步到 GitHub");
      } else {
        setSyncMessage("已是最新");
      }
    } catch (error) {
      console.error(error);
      setSyncState("error");
      setSyncMessage(error instanceof Error ? error.message : "同步失败");
    }
  }, [syncToken]);

  useEffect(() => {
    if (!syncToken || !data) return;
    void syncNow(syncToken);
  }, [data, syncNow, syncToken]);

  useEffect(() => {
    if (!syncToken || pendingChanges <= 0) return;
    const timer = window.setTimeout(() => {
      void syncNow();
    }, 8000);
    return () => window.clearTimeout(timer);
  }, [pendingChanges, syncNow, syncToken]);

  useEffect(() => {
    if (!syncToken) return;
    const timer = window.setInterval(() => {
      void syncNow();
    }, 60_000);
    return () => window.clearInterval(timer);
  }, [syncNow, syncToken]);

  useEffect(() => {
    function onVisibilityChange() {
      if (document.visibilityState === "visible" && syncToken) {
        void syncNow();
      }
    }
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => document.removeEventListener("visibilitychange", onVisibilityChange);
  }, [syncNow, syncToken]);

  async function chooseKnown() {
    if (!current || isRevealed) return;
    const selected = current;
    const saved = await saveRecognition(selected.id, "FAMILIAR");
    setProgress((prev) => new Map(prev).set(selected.id, saved));
    if (syncToken) setPendingChanges((value) => value + 1);
  }

  async function chooseUnknown() {
    if (!current || isRevealed) return;

    const selected = current;
    setRevealedEntry(selected);

    const saved = await saveRecognition(selected.id, "UNKNOWN");
    setProgress((prev) => new Map(prev).set(selected.id, saved));
    if (syncToken) setPendingChanges((value) => value + 1);
  }

  function continueAfterReveal() {
    setRevealedEntry(null);
  }

  async function enableSync() {
    const token = syncTokenInput.trim();
    if (!token) {
      setSyncState("error");
      setSyncMessage("请输入 Fine-grained GitHub Token。");
      return;
    }

    await saveSyncConfig({ token, enabled: true });
    setSyncToken(token);
    setSyncTokenInput("");
    setShowSyncSetup(false);
    setSyncState("idle");
    setSyncMessage("已保存到本机，正在验证并同步…");
  }

  async function disableSync() {
    await clearSyncConfig();
    setSyncToken(null);
    setSyncTokenInput("");
    setShowSyncSetup(false);
    setSyncState("off");
    setSyncMessage("未启用跨设备同步");
    setLastSyncedAt(null);
    setPendingChanges(0);
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

  const syncBadge =
    syncState === "syncing"
      ? "↻ 同步中"
      : syncState === "error"
        ? "⚠ 同步异常"
        : syncToken
          ? pendingChanges > 0
            ? `☁ 待同步 ${pendingChanges}`
            : "☁ 已同步"
          : "☁ 未启用";

  if (started) {
    return (
      <main className="shell study-shell">
        <header className="study-topbar">
          <button className="ghost" onClick={() => setStarted(false)}>← 返回</button>
          <div className="study-header-right">
            {syncToken && (
              <button
                className="sync-pill"
                onClick={() => void syncNow()}
                disabled={syncState === "syncing"}
                title={syncMessage}
              >
                {syncBadge}
              </button>
            )}
            <div className="study-progress-text">{completed} / {total} · {percent}%</div>
          </div>
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
                <p className="phonetic">/{displayEntry.lexical.phonetic}/</p>
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
                      词性：{displayEntry.lexical.pos.slice(0, 4).map((p) => p.tag).join(" / ")}
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

      <section className="panel sync-panel">
        <div className="panel-head">
          <div>
            <h3>跨设备同步</h3>
            <p className="muted sync-repo">{SYNC_REPOSITORY_LABEL} · Private</p>
          </div>
          <span className={`sync-status sync-status-${syncState}`}>{syncBadge}</span>
        </div>

        <p className="sync-message">{syncMessage}</p>

        {syncToken ? (
          <div className="sync-actions">
            <button
              className="primary"
              onClick={() => void syncNow()}
              disabled={syncState === "syncing"}
            >
              立即同步
            </button>
            <button className="ghost danger-ghost" onClick={() => void disableSync()}>
              移除此设备的 Token
            </button>
            <span className="sync-last">上次同步：{shortTime(lastSyncedAt)}</span>
          </div>
        ) : showSyncSetup ? (
          <div className="sync-setup">
            <label htmlFor="github-token">Fine-grained GitHub Token</label>
            <input
              id="github-token"
              type="password"
              value={syncTokenInput}
              onChange={(event) => setSyncTokenInput(event.target.value)}
              placeholder="github_pat_…"
              autoComplete="off"
              spellCheck={false}
            />
            <p className="muted">
              Token 只保存在当前设备浏览器 IndexedDB，不会提交到 GitHub。仅授权 cet-swipe-sync 的 Contents: Read and write。
            </p>
            <div className="sync-actions">
              <button className="primary" onClick={() => void enableSync()}>保存并同步</button>
              <button className="ghost" onClick={() => setShowSyncSetup(false)}>取消</button>
            </div>
          </div>
        ) : (
          <button className="primary" onClick={() => setShowSyncSetup(true)}>
            启用 GitHub Sync
          </button>
        )}
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
