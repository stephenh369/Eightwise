const SHAKE_THRESHOLD = 15;
const DEBOUNCE_MS = 800;

type DeviceMotionEventConstructor = typeof DeviceMotionEvent & {
  requestPermission?: () => Promise<"granted" | "denied">;
};

function accelerationMagnitude(
  ax: number | null,
  ay: number | null,
  az: number | null,
): number {
  const x = ax ?? 0;
  const y = ay ?? 0;
  const z = az ?? 0;
  return Math.sqrt(x * x + y * y + z * z);
}

export type ShakeController = {
  /** Call from a user gesture to request iOS motion permission when needed. */
  requestPermissionIfNeeded: () => Promise<boolean>;
  /** Start listening; safe to call multiple times. */
  start: () => void;
  stop: () => void;
};

export function createShakeDetector(onShake: () => void): ShakeController {
  let listening = false;
  let lastShakeAt = 0;
  let permissionGranted = false;

  function onDeviceMotion(event: DeviceMotionEvent) {
    const acc = event.accelerationIncludingGravity;
    if (!acc) return;

    const magnitude = accelerationMagnitude(
      acc.x,
      acc.y,
      acc.z,
    );

    if (magnitude < SHAKE_THRESHOLD) return;

    const now = Date.now();
    if (now - lastShakeAt < DEBOUNCE_MS) return;
    lastShakeAt = now;
    onShake();
  }

  async function requestPermissionIfNeeded(): Promise<boolean> {
    if (typeof DeviceMotionEvent === "undefined") {
      return false;
    }

    const DME = DeviceMotionEvent as DeviceMotionEventConstructor;
    if (typeof DME.requestPermission !== "function") {
      permissionGranted = true;
      return true;
    }

    if (permissionGranted) return true;

    try {
      const result = await DME.requestPermission();
      permissionGranted = result === "granted";
      return permissionGranted;
    } catch {
      return false;
    }
  }

  function start() {
    if (listening) return;
    if (typeof window === "undefined" || !window.addEventListener) return;

    window.addEventListener("devicemotion", onDeviceMotion);
    listening = true;
  }

  function stop() {
    if (!listening) return;
    window.removeEventListener("devicemotion", onDeviceMotion);
    listening = false;
  }

  return { requestPermissionIfNeeded, start, stop };
}
