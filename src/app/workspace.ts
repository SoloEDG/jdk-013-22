import { ref } from "vue";
import { createCamera } from "../features/panorama";
import { createPlayback } from "../features/chapters";
import { createDiscovery } from "../features/hotspots";
import { createBranch } from "../features/interviews";
import { createJournal } from "../features/journal";
import { createFocus, createGuide, createReading } from "../features/guide";
import { hotspots } from "../shared/content";
import type { Command, Position } from "../shared/types";
export function createWorkspace() {
  const camera = createCamera(),
    playback = createPlayback(),
    discovery = createDiscovery(() => playback.state),
    branch = createBranch(),
    journal = createJournal(),
    reading = createReading(),
    focus = createFocus(camera),
    tab = ref("story");
  // 推荐依据：当前播放位置（时间窗）+ 版本化阅读记录 + 手记收藏。
  const guide = createGuide({
    playback,
    camera,
    journal,
    reading,
    focus,
    discovery,
  });
  reading.markChapter(playback.state.chapterId);
  const position = (): Position => ({
    chapterId: playback.state.chapterId,
    time: playback.state.time,
    camera: { ...camera.camera },
    playing: playback.state.playing,
  });
  function enterPerson(id: string) {
    branch.enter(id, position());
    playback.state.playing = false;
    discovery.close();
    // 看过访谈是独立于收藏的阅读事实；无论从哪个章节进入，
    // 关联人物的热点都记为已读（可跨章节，如底部人物列表）。
    const linked = hotspots.find((h) => h.personId === id);
    if (linked) {
      reading.markInterview(linked.id);
      reading.markOpened(linked.id);
    }
  }
  function dispatch(command: Command) {
    switch (command.type) {
      case "chapter":
        if (branch.personId.value) return;
        playback.select(command.id);
        camera.reset();
        discovery.close();
        guide.cancelFocus();
        reading.markChapter(command.id);
        break;
      case "seek":
        playback.seek(command.time);
        break;
      case "hotspot":
        discovery.select(command.id);
        reading.markOpened(command.id);
        break;
      case "return": {
        const saved = branch.leave();
        if (saved) {
          playback.select(saved.chapterId);
          playback.seek(saved.time);
          camera.restore(saved.camera);
          playback.state.playing = saved.playing;
        }
        break;
      }
      case "revisit":
        branch.leave();
        playback.select(command.entry.chapterId);
        playback.seek(command.entry.time);
        camera.restore(command.entry.camera);
        discovery.select(command.entry.hotspotId);
        reading.markOpened(command.entry.hotspotId);
        tab.value = "story";
        break;
    }
  }
  function save() {
    const h = discovery.detail.value;
    if (h) journal.save(h, position());
  }
  return {
    camera,
    playback,
    discovery,
    branch,
    journal,
    reading,
    guide,
    tab,
    position,
    enterPerson,
    dispatch,
    save,
  };
}
