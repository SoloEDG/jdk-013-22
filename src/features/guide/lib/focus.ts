import { ref } from "vue";
import type { CameraController } from "../../panorama";
import { wrap } from "../../../shared/format";

// 推荐只负责“转镜头”，绝不触碰播放位置。
// 同一时刻最多有一个转向动画：每次启动都使上一个 token 失效，
// 用户手动拖动时同样令其失效，保证不会有多个动画互相抢镜头。
export function createFocus(controller: CameraController) {
  const active = ref(false);
  let raf = 0;
  let token = 0;

  function cancel() {
    token++;
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    active.value = false;
  }

  function lookAt(yaw: number, pitch: number, duration = 700) {
    cancel();
    const myToken = ++token;
    const from = { ...controller.camera };
    // 取最短弧，避免绕一整圈。
    const targetYaw = from.yaw + wrap(yaw - from.yaw);
    const targetPitch = pitch;
    const start = performance.now();
    active.value = true;

    const step = (now: number) => {
      if (myToken !== token) return; // 已被新的转向或手动拖动接管
      const t = Math.min(1, (now - start) / duration);
      const eased = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
      controller.restore({
        yaw: from.yaw + (targetYaw - from.yaw) * eased,
        pitch: from.pitch + (targetPitch - from.pitch) * eased,
        fov: from.fov,
      });
      if (t < 1) raf = requestAnimationFrame(step);
      else {
        raf = 0;
        active.value = false;
      }
    };
    raf = requestAnimationFrame(step);
  }

  return { active, lookAt, cancel };
}

export type Focus = ReturnType<typeof createFocus>;
