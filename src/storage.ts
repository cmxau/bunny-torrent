/** localStorage that never throws (it can be unavailable or blocked). */
export const store = {
  get: (k: string, d: string): string => {
    try {
      return localStorage.getItem(k) ?? d;
    } catch {
      return d;
    }
  },
  set: (k: string, v: string) => {
    try {
      localStorage.setItem(k, v);
    } catch {
      /* storage can be unavailable */
    }
  },
};
