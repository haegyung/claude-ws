/**
 * Terminal Local Echo - Predictive keystroke rendering
 *
 * Makes the terminal feel instant on high-latency connections by writing
 * printable characters to xterm immediately, then suppressing the server echo
 * when it arrives. This is the same technique SSH clients use.
 *
 * Handles:
 * - Printable character prediction (a-z, 0-9, symbols, space)
 * - Backspace prediction (erase last predicted char)
 * - Automatic rollback when prediction doesn't match server echo
 * - Passthrough for control chars, escape sequences, Enter (no prediction)
 */

interface Terminal {
  write: (data: string) => void;
}

// Max pending predictions before we stop predicting (safety valve)
const MAX_PENDING = 128;

// How long to wait before discarding stale predictions (e.g. program swallowed input)
const PREDICTION_TIMEOUT_MS = 2000;

export class TerminalLocalEcho {
  private pending: string[] = []; // predicted chars waiting for server echo
  private active = true; // false = passthrough mode (after mismatch or in raw-mode app)
  private cooldownTimer: ReturnType<typeof setTimeout> | null = null;
  private staleTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private terminal: Terminal) {}

  /**
   * Called when the user types input. Returns true if the char was locally echoed
   * (caller should still send it to the server, but xterm already shows it).
   */
  onInput(data: string): boolean {
    if (!this.active) return false;

    // Only predict single printable characters and backspace
    if (data.length !== 1) {
      // Multi-char = escape sequence (arrows, etc.) — don't predict
      return false;
    }

    const code = data.charCodeAt(0);

    // Backspace (0x7f) — erase last prediction
    if (code === 0x7f) {
      if (this.pending.length > 0) {
        this.pending.pop();
        this.terminal.write('\b \b'); // move back, clear, move back
        this.resetStaleTimer();
        return true;
      }
      return false;
    }

    // Control characters — don't predict (Enter, Ctrl+C, etc.)
    if (code < 0x20) return false;

    // Printable character — predict it
    if (this.pending.length >= MAX_PENDING) return false;

    this.pending.push(data);
    this.terminal.write(data);
    this.resetStaleTimer();
    return true;
  }

  /**
   * Called when server output arrives. Consumes matching predictions;
   * if mismatch, disables prediction temporarily and passes output through.
   * Returns the data that should actually be written to xterm (with echoed chars stripped).
   */
  onServerOutput(data: string): string {
    if (!this.active || this.pending.length === 0) return data;

    // Try to consume predictions from the start of server output
    let consumed = 0;
    while (consumed < data.length && this.pending.length > 0) {
      if (data[consumed] === this.pending[0]) {
        this.pending.shift();
        consumed++;
      } else {
        // Mismatch — rollback all remaining predictions and pass through
        this.rollback();
        return data;
      }
    }

    if (consumed > 0) {
      this.resetStaleTimer();
    }

    // Return unconsumed portion (or empty string if all was echo)
    return consumed < data.length ? data.slice(consumed) : '';
  }

  /** Erase predicted chars from screen and reset state */
  private rollback() {
    if (this.pending.length > 0) {
      // Erase each predicted character from the screen
      const eraseSeq = '\b \b'.repeat(this.pending.length);
      this.terminal.write(eraseSeq);
      this.pending = [];
    }
    // Enter cooldown — stop predicting briefly after a mismatch
    this.active = false;
    if (this.cooldownTimer) clearTimeout(this.cooldownTimer);
    this.cooldownTimer = setTimeout(() => {
      this.active = true;
      this.cooldownTimer = null;
    }, 500);
  }

  /** If predictions sit unmatched for too long, discard them */
  private resetStaleTimer() {
    if (this.staleTimer) clearTimeout(this.staleTimer);
    if (this.pending.length > 0) {
      this.staleTimer = setTimeout(() => {
        this.rollback();
        this.staleTimer = null;
      }, PREDICTION_TIMEOUT_MS);
    }
  }

  dispose() {
    if (this.cooldownTimer) clearTimeout(this.cooldownTimer);
    if (this.staleTimer) clearTimeout(this.staleTimer);
    this.pending = [];
  }
}
