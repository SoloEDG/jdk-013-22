<script setup lang="ts">
import {
  Compass,
  Clock,
  History,
  Navigation,
  BellRing,
  Bookmark,
  CheckCheck,
  ChevronDown,
  ChevronUp,
  X,
  ListChecks,
} from "lucide-vue-next";
import { chapters } from "../../../shared/content";
import { timecode } from "../../../shared/format";
import type { Clue, ClueStatus } from "../../../shared/types";
import { kindLabel } from "../../hotspots/lib/visibility";
import { statusMeta, type Guide } from "../model/guide";

defineProps<{ guide: Guide }>();

const statusIcon: Record<ClueStatus, typeof Navigation> = {
  reachable: Navigation,
  upcoming: Clock,
  review: History,
};

function chapterTitle(id: string) {
  return chapters.find((c) => c.id === id)?.title ?? "其他章节";
}

function marks(c: Clue) {
  const tags: string[] = [];
  if (c.read) tags.push("已看过");
  if (c.bookmarked) tags.push("已收藏");
  return tags;
}
</script>

<template>
  <section class="guide-card" aria-label="探索线索推荐">
    <header class="guide-head">
      <span class="guide-title"><Compass :size="14" /> 探索线索</span>
      <div class="guide-head-actions">
        <button
          v-if="!guide.current.value"
          class="guide-mini"
          @click="guide.restore()"
        >
          恢复推荐
        </button>
        <button v-else class="guide-mini" @click="guide.snooze()">
          暂时收起
        </button>
        <button class="guide-mini" @click="guide.toggleExpanded()">
          <ListChecks :size="13" />
          {{ guide.expanded.value ? "收起清单" : `全部线索${guide.otherUnread.value ? ` · ${guide.otherUnread.value} 条遗漏` : ""}` }}
          <ChevronUp v-if="guide.expanded.value" :size="13" />
          <ChevronDown v-else :size="13" />
        </button>
      </div>
    </header>

    <p v-if="guide.error.value" class="guide-error" role="alert">
      {{ guide.error.value }}
    </p>

    <!-- 收起态：不打扰，但遗漏线索仍可从清单找回 -->
    <p v-if="!guide.expanded.value && !guide.current.value" class="guide-muted">
      本章推荐已收起，自由转动视角即可探索；需要时从“全部线索”找回。
    </p>

    <!-- 单条主推荐：明确说明可达性依据 -->
    <article
      v-else-if="!guide.expanded.value && guide.current.value"
      class="guide-current"
      :class="`is-${guide.current.value.status}`"
    >
      <div class="clue-badges">
        <span class="clue-status" :class="`is-${guide.current.value.status}`">
          <component :is="statusIcon[guide.current.value.status]" :size="12" />
          {{ statusMeta[guide.current.value.status].label }}
        </span>
        <span v-for="t in marks(guide.current.value)" :key="t" class="clue-mark">
          <CheckCheck v-if="t === '已看过'" :size="11" />
          <Bookmark v-else :size="11" />
          {{ t }}
        </span>
      </div>
      <h3>{{ guide.current.value.hotspot.title }}</h3>
      <p class="clue-meta">
        {{ kindLabel(guide.current.value.hotspot.kind) }} ·
        {{ timecode(guide.current.value.hotspot.start) }}–{{
          timecode(guide.current.value.hotspot.end)
        }}
      </p>
      <p class="clue-reason">{{ guide.current.value.reason }}</p>
      <p class="clue-hint">{{ statusMeta[guide.current.value.status].hint }}</p>
      <button
        class="guide-cta"
        :class="`is-${guide.current.value.status}`"
        :disabled="guide.acting.value"
        @click="guide.act(guide.current.value!)"
      >
        <component :is="statusIcon[guide.current.value.status]" :size="14" />
        {{ guide.acting.value ? "镜头转动中…" : statusMeta[guide.current.value.status].action }}
      </button>
    </article>

    <!-- 等待条：等待不改变播放，跨时间窗后由模型统一提醒 -->
    <div v-if="guide.waiting.value" class="guide-waiting" role="status">
      <BellRing :size="14" />
      <span>
        正在等待“{{ guide.waiting.value.hotspot.title }}”出现
        <em v-if="guide.waiting.value.eta !== null">
          （约 {{ guide.waiting.value.eta }} 秒）
        </em>
      </span>
      <button class="guide-mini" @click="guide.cancelWaiting()">取消等待</button>
    </div>

    <!-- 展开清单：本章 + 其他章节，遗漏线索永远可找 -->
    <div v-if="guide.expanded.value" class="guide-list">
      <div class="guide-group">
        <small>本章线索（{{ guide.chapterClues.value.length }}）</small>
        <button
          v-for="c in guide.chapterClues.value"
          :key="c.hotspot.id"
          class="clue-row"
          :class="`is-${c.status}`"
          :disabled="guide.acting.value"
          @click="guide.act(c)"
        >
          <component :is="statusIcon[c.status]" :size="14" class="clue-row-icon" />
          <span class="clue-row-text">
            <b>
              {{ c.hotspot.title }}
              <i v-for="t in marks(c)" :key="t">{{ t }}</i>
            </b>
            <small>
              {{ statusMeta[c.status].label }} ·
              {{ timecode(c.hotspot.start) }}–{{ timecode(c.hotspot.end) }}
            </small>
          </span>
          <span class="clue-row-action">{{ statusMeta[c.status].action }}</span>
        </button>
      </div>
      <div
        v-for="g in guide.otherChapters.value"
        :key="g.chapter.id"
        class="guide-group"
      >
        <small>
          {{ chapterTitle(g.chapter.id) }} ·
          {{ g.clues.filter((c) => !c.read).length }} 条未看
          <em v-if="!g.visited" class="guide-unvisited">未到访章节</em>
        </small>
        <button
          v-for="c in g.clues"
          :key="c.hotspot.id"
          class="clue-row is-review"
          :disabled="guide.acting.value"
          @click="guide.act(c)"
        >
          <History :size="14" class="clue-row-icon" />
          <span class="clue-row-text">
            <b>
              {{ c.hotspot.title }}
              <i v-for="t in marks(c)" :key="t">{{ t }}</i>
            </b>
            <small>
              需要回看 · {{ chapterTitle(g.chapter.id) }} ·
              {{ timecode(c.hotspot.start) }}
            </small>
          </span>
          <span class="clue-row-action">确认回跳</span>
        </button>
      </div>
    </div>

    <!-- 回看确认：只有确认才允许改变播放位置 -->
    <div
      v-if="guide.confirmClue.value"
      class="guide-confirm-backdrop"
      @click.self="guide.cancelConfirm()"
    >
      <div class="guide-confirm" role="dialog" aria-modal="true" aria-label="确认回看">
        <button class="guide-confirm-close" aria-label="取消" @click="guide.cancelConfirm()">
          <X :size="15" />
        </button>
        <small>需要回看</small>
        <h4>{{ guide.confirmClue.value.hotspot.title }}</h4>
        <p>
          该线索位于《{{ chapterTitle(guide.confirmClue.value.hotspot.chapterId) }}》
          {{ timecode(guide.confirmClue.value.hotspot.start) }} 处。确认后将<template
            v-if="!guide.confirmSameChapter.value"
            >切换章节并</template
          >跳转到该时间点，当前播放位置会改变。
        </p>
        <div class="guide-confirm-actions">
          <button class="guide-mini" @click="guide.cancelConfirm()">
            取消，保持当前位置
          </button>
          <button class="guide-cta is-review" @click="guide.confirmReview()">
            <History :size="14" /> 确认回看
          </button>
        </div>
      </div>
    </div>

    <!-- 统一的可解释提醒：跨时间窗、写入失败后的恢复说明等 -->
    <p v-if="guide.notice.value" class="guide-notice" role="status">
      <BellRing :size="13" />
      <span>{{ guide.notice.value }}</span>
      <button aria-label="关闭提醒" @click="guide.dismissNotice()">
        <X :size="13" />
      </button>
    </p>
  </section>
</template>
