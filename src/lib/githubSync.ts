import {
  getAllProgress,
  putProgressBatch,
  type WordProgress,
} from "./progressDb";

const OWNER = "Yannnnnnnn19";
const REPO = "cet-swipe-sync";
const PATH = "progress-v1.json";
const BRANCH = "main";
const API_VERSION = "2022-11-28";

export const SYNC_REPOSITORY_LABEL = `${OWNER}/${REPO}`;

type RemoteProgressFile = {
  version: 1;
  updatedAt: string | null;
  words: Record<string, WordProgress>;
};

type GitHubContentResponse = {
  sha: string;
  content: string;
  encoding: "base64";
};

export type SyncResult = {
  progress: WordProgress[];
  pulled: number;
  pushed: boolean;
  syncedAt: string;
};

function encodeUtf8Base64(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

function decodeUtf8Base64(value: string): string {
  const binary = atob(value.replace(/\n/g, ""));
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function authHeaders(token: string): HeadersInit {
  return {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${token}`,
    "X-GitHub-Api-Version": API_VERSION,
  };
}

function apiUrl(): string {
  return `https://api.github.com/repos/${OWNER}/${REPO}/contents/${PATH}?ref=${BRANCH}`;
}

async function parseGitHubError(response: Response): Promise<Error> {
  let message = `GitHub API error ${response.status}`;
  try {
    const body = (await response.json()) as { message?: string };
    if (body.message) message += `: ${body.message}`;
  } catch {
    // Keep the status-only message.
  }

  if (response.status === 401) {
    message = "GitHub Token 无效或已过期。";
  } else if (response.status === 403) {
    message = "GitHub Token 没有 cet-swipe-sync 的 Contents 读写权限，或已达到 API 限制。";
  } else if (response.status === 404) {
    message = "无法读取 cet-swipe-sync/progress-v1.json，请检查 Token 是否授权了该私有仓库。";
  }
  return new Error(message);
}

async function readRemote(token: string): Promise<{ file: RemoteProgressFile; sha: string }> {
  const response = await fetch(apiUrl(), {
    method: "GET",
    headers: authHeaders(token),
  });
  if (!response.ok) throw await parseGitHubError(response);

  const body = (await response.json()) as GitHubContentResponse;
  const parsed = JSON.parse(decodeUtf8Base64(body.content)) as RemoteProgressFile;

  if (parsed.version !== 1 || typeof parsed.words !== "object") {
    throw new Error("远端 progress-v1.json 格式不受支持。");
  }
  return { file: parsed, sha: body.sha };
}

async function writeRemote(
  token: string,
  file: RemoteProgressFile,
  sha: string,
): Promise<void> {
  const response = await fetch(
    `https://api.github.com/repos/${OWNER}/${REPO}/contents/${PATH}`,
    {
      method: "PUT",
      headers: {
        ...authHeaders(token),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        message: "sync: update CET Swipe progress",
        content: encodeUtf8Base64(JSON.stringify(file, null, 2) + "\n"),
        sha,
        branch: BRANCH,
      }),
    },
  );

  if (!response.ok) {
    const error = await parseGitHubError(response);
    (error as Error & { status?: number }).status = response.status;
    throw error;
  }
}

function newer(a: WordProgress, b: WordProgress): WordProgress {
  const aTime = Date.parse(a.updatedAt);
  const bTime = Date.parse(b.updatedAt);
  if (aTime > bTime) return a;
  if (bTime > aTime) return b;
  if (a.recognitionAttempts > b.recognitionAttempts) return a;
  return b;
}

function mergeProgress(
  local: WordProgress[],
  remote: Record<string, WordProgress>,
): { records: WordProgress[]; pulled: number; remoteChanged: boolean } {
  const merged = new Map<string, WordProgress>();
  let pulled = 0;
  let remoteChanged = false;

  for (const [id, record] of Object.entries(remote)) {
    merged.set(id, record);
  }

  for (const localRecord of local) {
    const remoteRecord = merged.get(localRecord.id);
    if (!remoteRecord) {
      merged.set(localRecord.id, localRecord);
      remoteChanged = true;
      continue;
    }

    const winner = newer(localRecord, remoteRecord);
    if (winner === localRecord && winner !== remoteRecord) {
      merged.set(localRecord.id, localRecord);
      remoteChanged = true;
    } else if (winner === remoteRecord && remoteRecord !== localRecord) {
      const same =
        localRecord.status === remoteRecord.status &&
        localRecord.recognitionAttempts === remoteRecord.recognitionAttempts &&
        localRecord.updatedAt === remoteRecord.updatedAt;
      if (!same) pulled += 1;
    }
  }

  for (const id of Object.keys(remote)) {
    if (!local.some((record) => record.id === id)) pulled += 1;
  }

  return {
    records: [...merged.values()],
    pulled,
    remoteChanged,
  };
}

function toRemote(records: WordProgress[]): RemoteProgressFile {
  const words: Record<string, WordProgress> = {};
  for (const record of records) words[record.id] = record;
  return {
    version: 1,
    updatedAt: new Date().toISOString(),
    words,
  };
}

export async function syncProgressWithGitHub(token: string): Promise<SyncResult> {
  const cleanToken = token.trim();
  if (!cleanToken) throw new Error("请先配置 GitHub Token。");

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const local = await getAllProgress();
    const { file: remote, sha } = await readRemote(cleanToken);
    const merged = mergeProgress(local, remote.words);

    await putProgressBatch(merged.records);

    let pushed = false;
    if (merged.remoteChanged) {
      try {
        await writeRemote(cleanToken, toRemote(merged.records), sha);
        pushed = true;
      } catch (error) {
        const status = (error as Error & { status?: number }).status;
        if ((status === 409 || status === 422) && attempt < 2) {
          continue;
        }
        throw error;
      }
    }

    return {
      progress: merged.records,
      pulled: merged.pulled,
      pushed,
      syncedAt: new Date().toISOString(),
    };
  }

  throw new Error("同步冲突重试失败，请稍后再试。");
}
