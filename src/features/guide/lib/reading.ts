import { reactive, ref } from "vue";
import { CONTENT_VERSION, chapters, hotspots } from "../../../shared/content";

// 阅读进度与“探索手记”分开保存：手记可以删除，但“打开过/看过访谈”
// 属于已发生的观看事实，不应被一并抹掉。
const key = "tidal-reading-v1";

interface ReadingStore {
  version: string;
  opened: string[];
  interviews: string[];
  chapters: string[];
}

function emptyStore(): ReadingStore {
  return { version: CONTENT_VERSION, opened: [], interviews: [], chapters: [] };
}

function sanitize(raw: unknown): ReadingStore {
  if (!raw || typeof raw !== "object") return emptyStore();
  const data = raw as Partial<ReadingStore>;
  // 版本不一致：整体作废，旧版本读过的内容在新版本里重新获得推荐机会。
  if (data.version !== CONTENT_VERSION) return emptyStore();
  const valid = (list: unknown): string[] =>
    Array.isArray(list)
      ? [...new Set(list.filter((id): id is string => typeof id === "string"))].filter(
          (id) => hotspots.some((h) => h.id === id),
        )
      : [];
  return {
    version: CONTENT_VERSION,
    opened: valid(data.opened),
    interviews: valid(data.interviews),
    chapters: Array.isArray(data.chapters)
      ? [
          ...new Set(
            data.chapters.filter(
              (id): id is string =>
                typeof id === "string" && chapters.some((c) => c.id === id),
            ),
          ),
        ]
      : [],
  };
}

export function createReading() {
  let store: ReadingStore;
  try {
    store = sanitize(JSON.parse(localStorage.getItem(key) || "null"));
  } catch {
    store = emptyStore();
  }
  const opened = reactive(new Set(store.opened)),
    interviews = reactive(new Set(store.interviews)),
    visitedChapters = reactive(new Set(store.chapters)),
    error = ref("");

  function persist() {
    error.value = "";
    try {
      localStorage.setItem(
        key,
        JSON.stringify({
          version: CONTENT_VERSION,
          opened: [...opened],
          interviews: [...interviews],
          chapters: [...visitedChapters],
        } satisfies ReadingStore),
      );
    } catch {
      // 写入失败只影响跨刷新的记忆，当前会话的推荐依据仍然有效且可解释。
      error.value = "阅读进度未能写入本地，刷新后可能需要重新发现";
    }
  }

  return {
    opened,
    interviews,
    visitedChapters,
    error,
    isRead: (id: string) => opened.has(id) || interviews.has(id),
    markOpened: (id: string) => {
      if (!opened.has(id)) {
        opened.add(id);
        persist();
      }
    },
    markInterview: (id: string) => {
      if (!interviews.has(id)) {
        interviews.add(id);
        persist();
      }
    },
    markChapter: (id: string) => {
      if (!visitedChapters.has(id)) {
        visitedChapters.add(id);
        persist();
      }
    },
  };
}

export type Reading = ReturnType<typeof createReading>;
