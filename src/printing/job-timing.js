// Per-job stage timings (R3): one structured log line per print job so a
// before/after comparison on a real cash-register PC is a matter of reading
// the console. Not persisted; persistent logs are a separate piece of work.
//
// Stages, in ms since the previous one:
//   recepcion  the job arrived (always 0, it is the reference point)
//   armado     the document was built (HTML captured to an image, or ESC/POS
//              text encoded), including any wait in the print queue
//   envio      the bytes were handed to the printer transport
const STAGES = ['recepcion', 'armado', 'envio'];

/**
 * Starts timing a print job. Call mark('armado') and mark('envio') as the job
 * advances, then finish() exactly once (extra calls do not log again).
 * @param {string} job Document kind, e.g. 'receipt', 'invoice', 'order'.
 * @param {{now?: () => number, log?: (line: string) => void}} [deps]
 */
export function startJobTiming(job, { now = () => performance.now(), log = console.log } = {}) {
  const t0 = now();
  const marks = { recepcion: t0 };
  let finished = false;
  let currentMode = 'image';

  return {
    /** The print path records which one it took (image or text). */
    setMode(mode) {
      currentMode = mode;
    },
    mark(stage) {
      marks[stage] = now();
    },
    /**
     * Logs the line and returns the measured stages. Never throws, so it is
     * safe to call from a catch block with the job's own error.
     * @param {{mode?: string, error?: Error}} [info]
     */
    finish({ mode = currentMode, error } = {}) {
      const result = { job, mode };
      let previous = t0;
      for (const stage of STAGES) {
        if (marks[stage] == null) continue;
        result[stage] = Math.round(marks[stage] - previous);
        previous = marks[stage];
      }
      result.total = Math.round(previous - t0);
      if (error) result.error = error.message || String(error);

      if (!finished) {
        finished = true;
        const parts = [`job=${job}`, `mode=${mode}`];
        for (const stage of STAGES) {
          if (result[stage] != null) parts.push(`${stage}=${result[stage]}ms`);
        }
        parts.push(`total=${result.total}ms`);
        if (result.error) parts.push(`error="${result.error}"`);
        log(`[Timing] ${parts.join(' ')}`);
      }
      return result;
    },
  };
}
