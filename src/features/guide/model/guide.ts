import { computed, reactive, ref, watch } from "vue";
import { chapters, hotspots } from "../../../shared/content";
import type { Clue, ClueStatus } from "../../../shared/types";
import { timecode } from "../../../shared/format";
import type { Reading } from "../lib/reading";
import type { Focus } from "../lib/focus";
import type { Playback } from "../../chapters";
import type { CameraController } from "../../panorama";
import type { Journal } from "../../journal";

// discovery 只需要“选中热点打开详情”这一个能力，用最小接口避免循环依赖。
interface DiscoveryLike {
  select: (id: string) => void;
}

interface GuideDeps {
  playback: Playback;
  camera: CameraController;
  journal: Journal;
  reading: Reading;
  focus: Focus;
  discovery: DiscoveryLike;
}

const statusRank: Record<ClueStatus, number> = {
  reachable: 0,
  upcoming: 1,
  review: 2,
};

export const statusMeta: Record<
  ClueStatus,
  { label: string; hint: string; action: string }
> = {
  reachable: {
    label: "当前可达",
    hint: "时间窗已开启，点击只会转动镜头，不改变播放位置。",
    action: "转过去看看",
  },
  upcoming: {
    label: "即将出现",
    hint: "它还没到出现时间，点击后保持播放，到达时提醒你（不会快进）。",
    action: "到时提醒我",
  },
  review: {
    label: "需要回看",
    hint: "时间窗已经过去，需要确认后才会跳转回该时间点。",
    action: "回看这条线索",
  },
};

function hotspotById(id: string | null) {
  return id ? hotspots.find((h) => h.id === id) : undefined;
}

export function createGuide(deps: GuideDeps) {
  const { playback, camera, journal, reading, focus, discovery } = deps;
  // 会话内状态：收起与等待都不持久化。刷新后一切由“当前播放位置 +
  // 版本化阅读记录”重新推导，保证恢复时依据一致、可解释。
  const snoozed = reactive(new Set<string>());
  const waitingId = ref<string | null>(null);
  const confirmId = ref<string | null>(null);
  const expanded = ref(false);
  const notice = ref("");
  let noticeTimer: ReturnType<typeof setTimeout> | undefined;

  function notify(text: string) {
    notice.value = text;
    if (noticeTimer) clearTimeout(noticeTimer);
    noticeTimer = setTimeout(() => (notice.value = ""), 4200);
  }

  // 三态的唯一判定依据：本章时间窗与当前播放时间，与推荐生命周期无关。
  function statusOf(
    chapterId: string,
    start: number,
    end: number,
  ): ClueStatus {
    const time = playback.state.time;
    if (chapterId !== playback.state.chapterId) return "review";
    if (time >= start && time < end) return "reachable";
    if (time < start) return "upcoming";
    return "review";
  }

  function reasonOf(
    h: (typeof hotspots)[number],
    status: ClueStatus,
    read: boolean,
  ): string {
    if (status === "reachable")
      return read
        ? "你之前打开过它，想再看一遍随时可转回去"
        : "就在当前时间窗内，转动镜头即可发现";
    if (status === "upcoming")
      return `将在约 ${timecode(Math.max(0, h.start - playback.state.time))} 后出现`;
    return h.chapterId === playback.state.chapterId
      ? "它的时间窗已经过去，确认后可回到该时间点"
      : `位于《${chapters.find((c) => c.id === h.chapterId)?.title ?? "其他章节"}》，需要切章回看`;
  }

  function toClue(h: (typeof hotspots)[number]): Clue {
    const status = statusOf(h.chapterId, h.start, h.end);
    const read = reading.isRead(h.id);
    return {
      hotspot: h,
      status,
      read,
      bookmarked: journal.has(h.id),
      reason: reasonOf(h, status, read),
      eta:
        status === "upcoming"
          ? Math.max(0, Math.ceil(h.start - playback.state.time))
          : null,
    };
  }

  // 评分字典序：未读优先 → 可达优先于即将/回看 → 更早出现的优先。
  function score(c: Clue): [number, number, number] {
    return [c.read ? 1 : 0, statusRank[c.status], c.hotspot.start];
  }
  function byScore(list: Clue[]) {
    return [...list].sort((a, b) => {
      const sa = score(a),
        sb = score(b);
      for (let i = 0; i < 3; i++) if (sa[i] !== sb[i]) return sa[i] - sb[i];
      return 0;
    });
  }

  const chapterClues = computed<Clue[]>(() =>
    byScore(
      hotspots
        .filter((h) => h.chapterId === playback.state.chapterId)
        .map(toClue),
    ),
  );

  const otherChapters = computed(() =>
    chapters
      .filter((c) => c.id !== playback.state.chapterId)
      .map((c) => ({
        chapter: c,
        visited: reading.visitedChapters.has(c.id),
        clues: byScore(
          hotspots.filter((h) => h.chapterId === c.id).map(toClue),
        ),
      }))
      .filter((g) => g.clues.length > 0),
  );

  const otherUnread = computed(() =>
    otherChapters.value.reduce(
      (n, g) => n + g.clues.filter((c) => !c.read).length,
      0,
    ),
  );

  // 收起只是暂时不打扰；展开清单始终能找回全部线索。
  const current = computed<Clue | undefined>(() =>
    snoozed.has(playback.state.chapterId)
      ? undefined
      : chapterClues.value[0],
  );

  const waiting = computed(() => {
    const h = hotspotById(waitingId.value);
    return h ? toClue(h) : undefined;
  });

  const confirmClue = computed(() => {
    const h = hotspotById(confirmId.value);
    return h ? toClue(h) : undefined;
  });

  const confirmSameChapter = computed(
    () => confirmClue.value?.hotspot.chapterId === playback.state.chapterId,
  );

  // 播放跨过时间窗：等待中的线索转为可达或已错过，都给出可解释的提醒。
  watch(
    () => [playback.state.chapterId, playback.state.time] as const,
    ([chapterId, time]) => {
      const id = waitingId.value;
      if (!id) return;
      const h = hotspotById(id);
      if (!h || h.chapterId !== chapterId) {
        waitingId.value = null;
        return;
      }
      if (time >= h.start && time < h.end) {
        waitingId.value = null;
        notify(`“${h.title}”现在已经出现，点击线索即可转过去`);
      } else if (time >= h.end) {
        waitingId.value = null;
        notify(`“${h.title}”的时间窗已过，可在清单里选择回看`);
      }
    },
  );

  // 手动切章：等待随上下文作废，新章节的收起状态独立保留。
  // 章节到访记录由 workspace 统一写入，这里只维护会话内的等待状态。
  watch(
    () => playback.state.chapterId,
    () => {
      waitingId.value = null;
    },
  );

  function act(clue: Clue) {
    // 单飞：镜头动画进行中的重复点击直接忽略，不会启动第二个动画抢镜头。
    if (focus.active.value) return;
    if (clue.status === "review") {
      confirmId.value = clue.hotspot.id;
      return;
    }
    if (clue.status === "upcoming") {
      waitingId.value = clue.hotspot.id;
      notify(`已留意“${clue.hotspot.title}”，时间窗到达时提醒你`);
      return;
    }
    focus.lookAt(clue.hotspot.yaw, clue.hotspot.pitch);
  }

  function confirmReview() {
    const h = hotspotById(confirmId.value);
    confirmId.value = null;
    if (!h) return;
    const sameChapter = h.chapterId === playback.state.chapterId;
    if (!sameChapter) {
      playback.select(h.chapterId);
      reading.markChapter(h.chapterId);
      camera.reset();
      snoozed.delete(h.chapterId);
    }
    // 只有用户确认后才允许改变播放位置。
    playback.seek(h.start);
    waitingId.value = null;
    focus.lookAt(h.yaw, h.pitch);
    discovery.select(h.id);
    notify(sameChapter ? "已回到该线索所在的时间点" : "已切换章节并回到该线索");
  }

  return {
    current,
    chapterClues,
    otherChapters,
    otherUnread,
    waiting,
    confirmClue,
    confirmSameChapter,
    expanded,
    notice,
    acting: focus.active,
    error: reading.error,
    snooze: () => snoozed.add(playback.state.chapterId),
    restore: () => snoozed.delete(playback.state.chapterId),
    toggleExpanded: () => (expanded.value = !expanded.value),
    act,
    confirmReview,
    cancelConfirm: () => (confirmId.value = null),
    cancelWaiting: () => (waitingId.value = null),
    cancelFocus: () => focus.cancel(),
    dismissNotice: () => (notice.value = ""),
  };
}

export type Guide = ReturnType<typeof createGuide>;
